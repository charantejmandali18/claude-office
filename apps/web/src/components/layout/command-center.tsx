'use client';

import { useSocket } from '@/hooks/use-socket';
import { TopBar } from './top-bar';
import { OfficeFloor } from '../office/office-floor';
import { ChatPanel } from '../chat/chat-panel';
import { ActivityFeed } from '../activity/activity-feed';

export function CommandCenter() {
  const { sendMessage } = useSocket();

  return (
    <div className="flex flex-col h-screen">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        {/* Main area: office floor + activity feed */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Office floor — ~65% height */}
          <div className="h-[65%] overflow-hidden p-2">
            <OfficeFloor />
          </div>
          {/* Activity feed — ~35% height */}
          <div className="h-[35%] overflow-hidden">
            <ActivityFeed />
          </div>
        </div>

        {/* Chat panel — fixed width sidebar */}
        <div className="w-80 flex-shrink-0">
          <ChatPanel onSend={sendMessage} />
        </div>
      </div>
    </div>
  );
}
