// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { Suspense } from "react";
import type { Metadata } from "next";
import UserPage from "./page.client";

export const generateMetadata = async ({ params }: { params: Promise<{ owner: string }> }): Promise<Metadata> => {
  const { owner } = await params;
  return {
    title: `${owner}'s repos | StarMapper`,
    description: `Explore ${owner}'s public GitHub repositories and map their stargazers worldwide.`,
    alternates: { canonical: `/${owner}` },
    openGraph: {
      title: `${owner}'s repos | StarMapper`,
      description: `Explore ${owner}'s public GitHub repositories and map their stargazers worldwide.`,
      type: "profile",
    },
    twitter: { card: "summary" },
  };
};

export default function OwnerPage({ params }: { params: Promise<{ owner: string }> }) {
  return (
    <Suspense fallback={null}>
      <UserPage params={params} />
    </Suspense>
  );
}
