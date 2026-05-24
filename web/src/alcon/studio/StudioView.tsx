'use client';

import { CraftStudio } from '@/alcon/element/craft/CraftStudio';
import type { Craft } from '@/alcon/element/craft/types';

// Top-level Studio surface (sidebar ModeStrip → Studio). Reuses the
// CraftStudio component used inside Elements, but renders it inline
// (`embedded`) instead of as a fixed-position modal so the AppSidebar
// stays in view and the user can flip back to Home / Note / Chat etc.
//
// Because there's no parent Element to attach a Check-out to, we feed
// CraftStudio a synthetic element whose id scopes the in-progress
// localStorage session (`craft:studio-standalone:<format>`). Check-out
// just logs for now — when a personal-crafts table is added, swap the
// callback for the real persistence call.

const STANDALONE_ELEMENT = {
  id: 'studio-standalone',
  title: 'Studio',
  description: null,
};

interface Props {
  onClose?: () => void;
}

export function StudioView({ onClose }: Props) {
  return (
    <CraftStudio
      embedded
      element={STANDALONE_ELEMENT}
      onClose={() => onClose?.()}
      onCheckOut={(craft: Craft) => {
        // Standalone studio has nothing to attach to yet — keep the
        // session, but log so the action isn't a silent no-op while
        // a backing store is figured out.
        // eslint-disable-next-line no-console
        console.info('[Studio] checked out (no element attached):', craft.title, craft.format);
      }}
    />
  );
}
