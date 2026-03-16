'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useSocket } from '@/hooks/use-socket';
import { OfficeFloor } from '../office/office-floor';
import { Sidebar } from '../sidebar/sidebar';
import { ChatBar } from '../chat/chat-bar';
import { TopBar } from './top-bar';

const MIN_CHAT_HEIGHT = 120;
const MAX_CHAT_HEIGHT_RATIO = 0.8; // 80% of viewport height

export function CommandCenter() {
  const { sendMessage, summarize, openTerminal } = useSocket();
  const [chatHeight, setChatHeight] = useState(240);
  const isDragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      dragStartY.current = e.clientY;
      dragStartHeight.current = chatHeight;
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [chatHeight],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = dragStartY.current - e.clientY;
      const maxHeight = window.innerHeight * MAX_CHAT_HEIGHT_RATIO;
      const newHeight = Math.max(MIN_CHAT_HEIGHT, Math.min(maxHeight, dragStartHeight.current + delta));
      setChatHeight(newHeight);
    };

    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Top bar with RigelHQ heading */}
      <TopBar />

      {/* Main area: office floor + sidebar */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Office floor — fills remaining space, scrollable */}
        <div className="flex-1 min-h-0 overflow-auto bg-rigel-bg">
          <OfficeFloor />
        </div>

        {/* Right sidebar (metrics, agents, events) */}
        <div className="w-[340px] flex-shrink-0 min-h-0">
          <Sidebar onOpenTerminal={openTerminal} />
        </div>
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className="h-1.5 flex-shrink-0 bg-rigel-border hover:bg-rigel-blue/40 cursor-row-resize transition-colors duration-150 group relative"
        title="Drag to resize chat"
      >
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <span className="w-4 h-0.5 rounded-full bg-rigel-blue/60" />
          <span className="w-4 h-0.5 rounded-full bg-rigel-blue/60" />
          <span className="w-4 h-0.5 rounded-full bg-rigel-blue/60" />
        </div>
      </div>

      {/* Bottom chat command bar — height controlled by drag */}
      <div className="flex-shrink-0 overflow-hidden" style={{ height: chatHeight }}>
        <ChatBar onSend={sendMessage} onSummarize={summarize} />
      </div>
    </div>
  );
}
