// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { Suspense } from "react";
import { cacheLife, cacheTag } from "next/cache";
import ProfilePageClient from "./page.client";
import type { ProfileResponse } from "@/app/api/profile/[login]/route";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";

const fetchProfile = async (login: string): Promise<ProfileResponse | null> => {
  "use cache";
  cacheTag(`profile-${login}`);
  cacheLife("minutes");
  try {
    const res = await fetch(`${APP_URL}/api/profile/${encodeURIComponent(login)}`);
    if (!res.ok) return null;
    return res.json() as Promise<ProfileResponse>;
  } catch {
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
