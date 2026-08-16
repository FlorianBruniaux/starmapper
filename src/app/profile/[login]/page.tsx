// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { Suspense } from "react";
import { cacheLife, cacheTag } from "next/cache";
import ProfilePageClient from "./page.client";
import { fetchProfile as queryProfile } from "@/lib/profile-query";
import { logError } from "@/lib/api-helpers";
import type { ProfileResponse } from "@/app/api/profile/[login]/route";

const fetchProfile = async (login: string): Promise<ProfileResponse | null> => {
  "use cache";
  cacheTag(`profile-${login}`);
  // Profile data only moves when /api/profile/[login]/refresh runs, and that route carries
  // a 1h internal cooldown plus a 10-per-hour rate limit. Rewriting every 60s for data that
  // cannot change more than hourly threw away 59 writes out of 60. The refresh route now
  // invalidates this tag, so a manual refresh is still visible immediately.
  cacheLife({ stale: 300, revalidate: 1800, expire: 86400 });
  try {
    // Direct call rather than fetch(APP_URL + "/api/profile/…"): the handler only wraps
    // queryProfile and turns its discriminated result into a status code. Both 400 and 404
    // collapse to null here, exactly as the previous `!res.ok` check did.
    const result = await queryProfile(login);
    return result.ok ? result.profile : null;
  } catch (err) {
    logError("profile page", err);
    return null;
  }
};

const ProfileContent = async ({ params }: { params: Promise<{ login: string }> }) => {
  const { login } = await params;
  const initialProfile = await fetchProfile(login);
  return <ProfilePageClient login={login} initialProfile={initialProfile} />;
};

export default function ProfilePage({ params }: { params: Promise<{ login: string }> }) {
  return (
    <Suspense fallback={null}>
      <ProfileContent params={params} />
    </Suspense>
  );
}
