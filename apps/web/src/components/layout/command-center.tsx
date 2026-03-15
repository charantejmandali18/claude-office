'use client';

import { useSocket } from '@/hooks/use-socket';
import { OfficeFloor } from '../office/office-floor';
import { Sidebar } from '../sidebar/sidebar';
import { ChatBar } from '../chat/chat-bar';

export function CommandCenter() {
  const { sendMessage } = useSocket();

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Main area: office floor + sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Office floor — fills remaining space */}
        <div className="flex-1 overflow-hidden">
          <OfficeFloor />
        </div>

        {/* Right sidebar (metrics, agents, events) */}
        <div className="w-[340px] flex-shrink-0">
          <Sidebar />
        </div>
      </div>

      {/* Bottom chat command bar */}
      <ChatBar onSend={sendMessage} />
    </div>
  );
}
