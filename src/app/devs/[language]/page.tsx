// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { Suspense } from "react";
import DevsLanguageClient from "@/app/devs/[language]/page.client";

type Props = {
  params: Promise<{ language: string }>;
};

const DevsLanguagePageContent = async ({ params }: Props) => {
  const { language: slug } = await params;
  return <DevsLanguageClient initialSlug={decodeURIComponent(slug)} />;
};

export default function DevsLanguagePage({ params }: Props) {
  return (
    <Suspense fallback={null}>
      <DevsLanguagePageContent params={params} />
    </Suspense>
  );
}
