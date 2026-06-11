// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { Metadata } from "next";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { FeedsPageClient } from "@/app/feeds/page.client";

export const metadata: Metadata = {
  title: "Your feeds | StarMapper",
  description: "Latest announcements from developers you follow on StarMapper.",
  robots: { index: false, follow: false },
};

const FeedsPage = () => (
  <div className="min-h-screen bg-background text-foreground flex flex-col">
    <Header sticky showNav />
    <main id="main" className="w-full max-w-7xl mx-auto px-4 py-10 pb-16 flex-1">
      <FeedsPageClient />
    </main>
    <Footer />
  </div>
);

export default FeedsPage;
