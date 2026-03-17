import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { listSessions as sdkListSessions } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, EventStream } from '@rigelhq/shared';
import { generateRunId, generateEventId } from '@rigelhq/shared';
import type { GatewayAdapter, SessionHandle, AgentEventCallback, SessionOptions, SessionInfo } from './adapter.js';

interface ActiveCLI {
  proc: ChildProcess;
  configId: string;
  sessionId: string;
  onEvent: AgentEventCallback;
  emit: (stream: EventStream, data: AgentEvent['data'], agentId?: string) => Promise<void>;
  /** Active teammate agent IDs that haven't completed yet */
  activeTeammates: Set<string>;
}

export class ClaudeAdapter implements GatewayAdapter {
  private cliProcesses = new Map<string, ActiveCLI>();
  /** Map tool_use_id → agent name from Agent tool calls */
  private toolUseToAgent = new Map<string, string>();

  async createSession(
    configId: string,
    initialPrompt: string,
    onEvent: AgentEventCallback,
    options?: SessionOptions,
  ): Promise<SessionHandle> {
    const runId = generateRunId();
    let seq = 0;
    let sessionId = '';

    const emit = async (stream: EventStream, data: AgentEvent['data'], agentId?: string) => {
      seq += 1;
      await onEvent({
        id: generateEventId(),
        agentId: agentId ?? configId,
        runId,
        seq,
        stream,
        timestamp: Date.now(),
        data,
      });
    };

    // Build the initial message — prepend system prompt if provided
    const fullPrompt = options?.systemPrompt
      ? JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [
              { type: 'text', text: `[System Instructions]\n${options.systemPrompt}\n\n[User Message]\n${initialPrompt}` },
            ],
          },
        })
      : JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'text', text: initialPrompt }],
          },
        });

    // Spawn Claude CLI with bidirectional streaming
    const proc = spawn('claude', [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--dangerously-skip-permissions',
    ], {
      env: {
        ...process.env,
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
      },
      cwd: options?.cwd ?? process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    console.log(`[Claude] CLI spawned for ${configId} (PID: ${proc.pid})`);

    const cli: ActiveCLI = { proc, configId, sessionId: '', onEvent, emit, activeTeammates: new Set() };

    // Parse stdout JSON lines
    let buffer = '';
    proc.stdout!.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          this.processMessage(msg, configId, emit, cli).catch((err) => {
            console.error(`[Claude] Error processing message for ${configId}:`, err);
          });
        } catch {
          // Not valid JSON — ignore
        }
      }
    });

    proc.stderr!.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text && !text.includes('Debug:')) {
        console.log(`[Claude] ${configId} stderr: ${text.slice(0, 200)}`);
      }
    });

    proc.on('close', (code) => {
      console.log(`[Claude] CLI process for ${configId} exited (code: ${code})`);
      // Mark any still-active teammates as completed
      if (cli.activeTeammates.size > 0) {
        console.log(`[Claude] Marking ${cli.activeTeammates.size} teammates as completed on exit`);
        for (const name of cli.activeTeammates) {
          emit('lifecycle', { phase: 'end' }, name).catch(() => {});
        }
        cli.activeTeammates.clear();
      }
      this.cliProcesses.delete(configId);
      emit('lifecycle', { phase: 'end' }).catch(() => {});
    });

    // Send the initial prompt
    proc.stdin!.write(fullPrompt + '\n');

    // Wait for session ID from init message
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 10_000);
      const check = setInterval(() => {
        if (cli.sessionId) {
          clearInterval(check);
          clearTimeout(timeout);
          resolve();
        }
      }, 100);
    });

    sessionId = cli.sessionId;
    this.cliProcesses.set(configId, cli);

    await emit('lifecycle', { phase: 'start' });

    const handle: SessionHandle = {
      sessionId,
      configId,
      send: async (message: string) => {
        const entry = this.cliProcesses.get(configId);
        if (!entry?.proc.stdin?.writable) {
          throw new Error(`CLI process for ${configId} is not writable`);
        }
        const msg = JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'text', text: message }],
          },
        });
        entry.proc.stdin.write(msg + '\n');
      },
      close: async () => {
        const entry = this.cliProcesses.get(configId);
        if (entry) {
          entry.proc.stdin?.end();
          entry.proc.kill();
          this.cliProcesses.delete(configId);
        }
      },
    };

    return handle;
  }

  /** Process a single JSON message from the CLI stdout */
  private async processMessage(
    msg: Record<string, unknown>,
    configId: string,
    emit: (stream: EventStream, data: AgentEvent['data'], agentId?: string) => Promise<void>,
    cli: ActiveCLI,
  ): Promise<void> {
    const type = msg.type as string;
    const subtype = (msg.subtype as string) ?? '';
    // Log every message type for debugging
    if (type !== 'user' || (msg.tool_use_result as Record<string, unknown>)) {
      console.log(`[Claude] MSG: type=${type} subtype=${subtype} parent_tool_use_id=${msg.parent_tool_use_id ?? 'none'}`);
    }

    if (type === 'system') {
      const subtype = msg.subtype as string;

      if (subtype === 'init') {
        const sid = msg.session_id as string;
        if (sid) {
          cli.sessionId = sid;
          console.log(`[Claude] Session init for ${configId}: ${sid}`);
        }
      } else if (subtype === 'task_started') {
        const taskDesc = (msg.description as string) ?? '';
        const toolUseId = msg.tool_use_id as string | undefined;
        const agentId = this.resolveAgentId(msg, toolUseId);
        const taskType = msg.task_type as string;
        console.log(`[Claude] ${taskType === 'in_process_teammate' ? 'TEAMMATE' : 'Agent'} started: ${agentId} — "${taskDesc.slice(0, 60)}"`);
        await emit('lifecycle', { phase: 'start', taskId: msg.task_id, taskType }, agentId);
        await emit('assistant', { text: `Working on: ${taskDesc}` }, agentId);
      } else if (subtype === 'task_progress') {
        const toolUseId = msg.tool_use_id as string | undefined;
        const agentId = this.resolveAgentId(msg, toolUseId);
        const lastTool = msg.last_tool_name as string | undefined;
        if (lastTool) {
          await emit('tool', { tool: lastTool, phase: 'start' }, agentId);
          await emit('tool', { tool: lastTool, phase: 'end' }, agentId);
        }
        const summary = msg.summary as string | undefined;
        if (summary) {
          await emit('assistant', { text: summary }, agentId);
        }
        await emit('lifecycle', { phase: 'thinking' }, agentId);
      } else if (subtype === 'task_notification') {
        const status = msg.status as string;
        const summary = (msg.summary as string) ?? '';
        const toolUseId = msg.tool_use_id as string | undefined;
        const agentId = this.resolveAgentId(msg, toolUseId);
        if (summary) {
          await emit('assistant', { text: summary }, agentId);
        }
        if (status === 'failed') {
          await emit('error', { error: 'Task failed' }, agentId);
        }
        await emit('lifecycle', { phase: 'end' }, agentId);
        if (toolUseId) this.toolUseToAgent.delete(toolUseId);
        console.log(`[Claude] ${agentId} completed (${status})`);
      }
    } else if (type === 'assistant') {
      const message = msg.message as Record<string, unknown>;
      const content = message?.content as Array<Record<string, unknown>>;
      if (!content) return;

      // Check if this is from a teammate (parent_tool_use_id present)
      const parentToolUseId = msg.parent_tool_use_id as string | undefined;
      const agentId = parentToolUseId ? this.toolUseToAgent.get(parentToolUseId) : undefined;

      await emit('lifecycle', { phase: 'thinking' }, agentId);
      for (const block of content) {
        if (block.type === 'text') {
          await emit('assistant', { text: block.text as string }, agentId);
        } else if (block.type === 'tool_use') {
          const toolName = block.name as string;
          const toolId = block.id as string;
          const input = block.input as Record<string, unknown>;

          if (toolName === 'Agent') {
            const agentName = (input.name as string) ?? (input.subagent_type as string);
            if (agentName) {
              this.toolUseToAgent.set(toolId, agentName);
              const teamName = input.team_name as string | undefined;
              console.log(`[Claude] Agent call ${toolId} → ${agentName}${teamName ? ` (team: ${teamName})` : ''}`);
            }
          } else if (toolName === 'TeamCreate') {
            console.log(`[Claude] TeamCreate: ${input.team_name}`);
          } else if (toolName === 'SendMessage') {
            const to = (input.to as string) ?? (input.recipient as string);
            console.log(`[Claude] SendMessage to: ${to}`);
            // Emit as communication event so the UI can show agent-to-agent lines
            if (to && agentId) {
              await emit('assistant', { text: `[Message to ${to}]` }, agentId);
            }
          }

          await emit('tool', { tool: toolName, phase: 'start', toolArgs: input }, agentId);
          await emit('tool', { tool: toolName, phase: 'end' }, agentId);
        }
      }
    } else if (type === 'result') {
      console.log(`[Claude] Result: ${msg.subtype} (session stays alive for teammates)`);
      // Don't emit lifecycle:end — the CLI process stays alive for teammates
    } else if (type === 'user') {
      // Tool results / user messages — check for teammate events
      const toolResult = msg.tool_use_result as Record<string, unknown> | undefined;
      if (toolResult?.status === 'teammate_spawned') {
        const name = toolResult.name as string;
        const teamName = toolResult.team_name as string;
        cli.activeTeammates.add(name);
        console.log(`[Claude] Teammate confirmed: ${name}@${teamName} (${cli.activeTeammates.size} active)`);
      } else if (toolResult?.status === 'completed') {
        // Teammate completed — the tool_result comes back with the agent's output
        const agentId = toolResult.agentId as string | undefined;
        const toolUseId = msg.message as Record<string, unknown>;
        const content = toolUseId?.content as Array<Record<string, unknown>>;

        // Try to find which agent this belongs to from the tool_use_id
        let resolvedAgent: string | undefined;
        if (content) {
          for (const block of content) {
            const tuId = block.tool_use_id as string | undefined;
            if (tuId && this.toolUseToAgent.has(tuId)) {
              resolvedAgent = this.toolUseToAgent.get(tuId);
              break;
            }
          }
        }

        if (resolvedAgent) {
          cli.activeTeammates.delete(resolvedAgent);
          console.log(`[Claude] Teammate completed: ${resolvedAgent} (${cli.activeTeammates.size} remaining)`);
          await emit('lifecycle', { phase: 'end' }, resolvedAgent);
        } else if (agentId) {
          // Try to match agentId format like "a1234..." to a name
          console.log(`[Claude] Tool result completed: agentId=${agentId}`);
        }
      }
    }
  }

  async listSessions(): Promise<SessionInfo[]> {
    try {
      const sessions = await sdkListSessions();
      return sessions.map((s) => ({
        sessionId: s.sessionId,
        summary: s.summary,
        lastModified: s.lastModified,
        cwd: s.cwd,
        gitBranch: s.gitBranch,
        createdAt: s.createdAt,
      }));
    } catch (err) {
      console.error('[Claude] Failed to list sessions:', err);
      return [];
    }
  }

  async stop(handle: SessionHandle): Promise<void> {
    await handle.close();
  }

  async stopAll(): Promise<void> {
    for (const [, entry] of this.cliProcesses) {
      entry.proc.stdin?.end();
      entry.proc.kill();
    }
    this.cliProcesses.clear();
  }

  /** Resolve agent ID from task events */
  private resolveAgentId(msg: Record<string, unknown>, toolUseId?: string): string {
    if (typeof msg.subagent_type === 'string') return msg.subagent_type;
    if (toolUseId && this.toolUseToAgent.has(toolUseId)) {
      return this.toolUseToAgent.get(toolUseId)!;
    }
    const desc = (msg.description as string) ?? '';
    if (msg.task_type === 'in_process_teammate') {
      const colonIdx = desc.indexOf(':');
      if (colonIdx > 0) {
        const name = desc.slice(0, colonIdx).trim();
        if (name) return name;
      }
    }
    return extractAgentId(desc || (msg.summary as string));
  }
}

/** Extract agent ID from description text */
function extractAgentId(desc: string | undefined): string {
  if (!desc) return 'subagent';
  const match = desc.match(/^\[?([a-z][\w-]*)\]?/i);
  return match?.[1] ?? 'subagent';
}
