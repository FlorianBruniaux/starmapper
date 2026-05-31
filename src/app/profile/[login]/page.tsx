// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Profile pages depend on a dynamic [login] segment and hit the live API —
// can't be statically prerendered at build time.
export const dynamic = "force-dynamic";

import ProfilePageClient from "./page.client";
import type { ProfileResponse } from "@/app/api/profile/[login]/route";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";

const fetchProfile = async (login: string): Promise<ProfileResponse | null> => {
  try {
    const res = await fetch(
      `${APP_URL}/api/profile/${encodeURIComponent(login)}`,
      { next: { revalidate: 300, tags: [`profile-${login}`] } },
    );
    if (!res.ok) return null;
    return res.json() as Promise<ProfileResponse>;
  } catch {
    return null;
  }
};

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ login: string }>;
}) {
  const { login } = await params;
  const initialProfile = await fetchProfile(login);
  return <ProfilePageClient login={login} initialProfile={initialProfile} />;
}
