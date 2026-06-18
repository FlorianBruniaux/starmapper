// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { Suspense } from "react";
import DevsCountryClient from "@/app/devs/in/[country]/page.client";

type Props = {
  params: Promise<{ country: string }>;
};

const DevsCountryPageContent = async ({ params }: Props) => {
  const { country: slug } = await params;
  return <DevsCountryClient initialSlug={decodeURIComponent(slug)} />;
};

export default function DevsCountryPage({ params }: Props) {
  return (
    <Suspense fallback={null}>
      <DevsCountryPageContent params={params} />
    </Suspense>
  );
}
