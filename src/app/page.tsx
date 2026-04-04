'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Navbar } from '@/components/layout/Navbar';
import { ChatView } from '@/components/chat/ChatView';
import { SkillsView } from '@/components/skills/SkillsView';
import { TeachView } from '@/components/teach/TeachView';
import { DashboardView } from '@/components/dashboard/DashboardView';
import { useAppStore } from '@/store/app-store';

const viewComponents = {
  chat: ChatView,
  skills: SkillsView,
  teach: TeachView,
  dashboard: DashboardView,
};

export default function Home() {
  const activeView = useAppStore((state) => state.activeView);
  const ActiveComponent = viewComponents[activeView];

  return (
    <div className="dark flex h-screen flex-col overflow-hidden bg-background">
      <Navbar />
      <main className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeView}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="h-full"
          >
            <ActiveComponent />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
