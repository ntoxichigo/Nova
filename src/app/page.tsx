'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ChatView } from '@/components/chat/ChatView';
import { DashboardView } from '@/components/dashboard/DashboardView';
import { DoctorView } from '@/components/doctor/DoctorView';
import { ScriptsView } from '@/components/editor/ScriptsView';
import { AppShell } from '@/components/layout/AppShell';
import { OpsView } from '@/components/ops/OpsView';
import { SettingsView } from '@/components/settings/SettingsView';
import { SkillsView } from '@/components/skills/SkillsView';
import { TeachView } from '@/components/teach/TeachView';
import { useAppStore } from '@/store/app-store';

const viewComponents = {
  chat: ChatView,
  scripts: ScriptsView,
  skills: SkillsView,
  teach: TeachView,
  dashboard: DashboardView,
  ops: OpsView,
  doctor: DoctorView,
  settings: SettingsView,
};

export default function Home() {
  const activeView = useAppStore((state) => state.activeView);
  const ActiveComponent = viewComponents[activeView];

  return (
    <AppShell>
      <AnimatePresence mode="wait">
        <motion.div
          key={activeView}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="h-full overflow-hidden"
        >
          <ActiveComponent />
        </motion.div>
      </AnimatePresence>
    </AppShell>
  );
}
