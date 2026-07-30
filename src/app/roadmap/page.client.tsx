// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, HelpCircle, ArrowRight, X, Mail } from "lucide-react";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { StargazerNoticeModal } from "@/components/stargazer-notice-modal";
import { STARGAZER_NOTICE_HEADLINE, STARGAZER_NOTICE_BODY, STARGAZER_NOTICE_LINKS } from "@/lib/stargazer-notice";
import { STILL_WORKING_LINKS } from "@/lib/still-working-links";
import { ROADMAP_OPTIONS } from "@/lib/roadmap-vote-copy";
import { getStoredVote, saveStoredVote } from "@/lib/roadmap-vote-copy";
import type { Option } from "@/lib/roadmap-vote";
import type { RoadmapVoteResponse } from "@/app/api/roadmap-vote/route";

type Props = { initialTallies: RoadmapVoteResponse };

const StatusTag = ({ status, label }: { status: "decided" | "evaluating"; label: string }) => (
  <span
    className={[
      "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-bold uppercase tracking-wide border",
      status === "decided"
        ? "bg-accent-green/10 text-accent-green border-accent-green/20"
        : "bg-accent-blue/10 text-accent-blue border-accent-blue/20",
    ].join(" ")}
  >
    {status === "decided" ? <Check size={10} aria-hidden="true" /> : <HelpCircle size={10} aria-hidden="true" />}
    {label}
  </span>
);

type ContactModalProps = {
  submitting: boolean;
  onAnonymous: () => void;
  onWithContact: (email: string, name: string, message: string) => void;
  onClose: () => void;
};

const VoteContactModal = ({ submitting, onAnonymous, onWithContact, onClose }: ContactModalProps) => {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(false);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="vote-contact-title"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-xl bg-surface border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 p-1.5 rounded text-muted-subtle hover:text-foreground transition-colors"
        >
          <X size={16} aria-hidden="true" />
        </button>

        <div className="p-6 flex flex-col gap-4">
          <h2 id="vote-contact-title" className="text-lg font-bold text-foreground">
            One more thing before you submit
          </h2>

          {!showForm ? (
            <>
              <p className="text-sm text-muted leading-relaxed">
                Vote anonymously, or leave your email so I can follow up with the people who
                voted. No marketing, ever, just this conversation.
              </p>
              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="button"
                  onClick={onAnonymous}
                  disabled={submitting}
                  className="w-full bg-accent-green text-white font-semibold px-4 py-2 rounded-md
                             text-sm hover:opacity-90 transition-opacity disabled:opacity-50
                             focus:outline-none focus:ring-2 focus:ring-accent-blue/40"
                >
                  {submitting ? "Submitting…" : "Submit anonymously"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(true)}
                  className="w-full flex items-center justify-center gap-2 border border-border text-muted px-4 py-2
                             rounded-md text-sm hover:text-foreground hover:border-accent-blue/50 transition-colors
                             focus:outline-none focus:ring-2 focus:ring-accent-blue/40"
                >
                  <Mail size={14} aria-hidden="true" />
                  Leave my email instead
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted leading-relaxed">
                Just for this: I&apos;ll reach out to talk about the roadmap. No marketing, no
                third party, ever.
              </p>
              <div className="flex flex-col gap-3">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="bg-surface-alt border border-border rounded-md px-3 py-2 text-sm
                             text-foreground placeholder:text-muted
                             focus:ring-2 focus:ring-accent-blue/40 focus:border-accent-blue min-h-11"
                />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name (optional)"
                  className="bg-surface-alt border border-border rounded-md px-3 py-2 text-sm
                             text-foreground placeholder:text-muted
                             focus:ring-2 focus:ring-accent-blue/40 focus:border-accent-blue min-h-11"
                />
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Anything you want to add (optional)"
                  rows={3}
                  className="bg-surface-alt border border-border rounded-md px-3 py-2 text-sm
                             text-foreground placeholder:text-muted resize-none
                             focus:ring-2 focus:ring-accent-blue/40 focus:border-accent-blue"
                />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onWithContact(email, name, message)}
                  disabled={submitting || !email}
                  className="flex-1 bg-accent-green text-white font-semibold px-4 py-2 rounded-md
                             text-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed
                             focus:outline-none focus:ring-2 focus:ring-accent-blue/40"
                >
                  {submitting ? "Submitting…" : "Submit with my email"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="text-sm text-muted hover:text-foreground transition-colors px-2"
                >
                  Back
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const RoadmapPageClient = ({ initialTallies }: Props) => {
  const [selected, setSelected] = useState<Option[]>([]);
  const [voted, setVoted] = useState(false);
  const [tallies, setTallies] = useState<RoadmapVoteResponse>(initialTallies);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [contactModalOpen, setContactModalOpen] = useState(false);

  useEffect(() => {
    const stored = getStoredVote();
    if (stored && stored.length > 0) {
      setSelected(stored);
      setVoted(true);
    }
  }, []);

  const toggle = (option: Option) => {
    setSelected((prev) =>
      prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option],
    );
  };

  const submit = async (contact?: { email: string; name?: string; message?: string }) => {
    if (selected.length === 0 || submitting) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/roadmap-vote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ options: selected, ...(contact ? { contact } : {}) }),
      });
      if (!res.ok) throw new Error("vote failed");
      const data = (await res.json()) as { tallies: RoadmapVoteResponse["tallies"]; totalVoters: number };
      setTallies({ tallies: data.tallies, totalVoters: data.totalVoters });
      saveStoredVote(selected);
      setVoted(true);
      setContactModalOpen(false);
      setFeedback(voted ? "Vote updated." : "Thanks, vote recorded.");
    } catch {
      setFeedback("Vote failed, try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const pct = (option: Option): number =>
    tallies.totalVoters > 0 ? Math.round((tallies.tallies[option] / tallies.totalVoters) * 100) : 0;

  return (
    <>
      {modalOpen && <StargazerNoticeModal onClose={() => setModalOpen(false)} />}
      {contactModalOpen && (
        <VoteContactModal
          submitting={submitting}
          onAnonymous={() => submit()}
          onWithContact={(email, name, message) =>
            submit({ email, name: name || undefined, message: message || undefined })
          }
          onClose={() => setContactModalOpen(false)}
        />
      )}
      <Header sticky showNav innerMaxWidth="max-w-5xl" />

      <main id="main" className="w-full max-w-5xl mx-auto px-4 lg:px-6 pt-24 pb-20 space-y-14">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center gap-2 list-none p-0 m-0">
            <li>
              <Link href="/" className="text-xs text-muted-subtle hover:text-muted transition-colors">Home</Link>
            </li>
            <li aria-hidden="true" className="text-muted-subtle text-xs">/</li>
            <li>
              <span className="text-xs text-muted" aria-current="page">Roadmap</span>
            </li>
          </ol>
        </nav>

        {/* Hero */}
        <section className="space-y-4">
          <h1 className="text-2xl font-bold text-foreground leading-tight">{STARGAZER_NOTICE_HEADLINE}</h1>
          <p className="text-muted leading-relaxed">
            On July 23 2026 GitHub cut off the one API StarMapper is built on: the public
            stargazers list. I&apos;ve spent the weeks since figuring out what to do about it.
            Here&apos;s where that landed, and four ways it can go next.
          </p>
        </section>

        {/* What broke */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">What broke</h2>
          {STARGAZER_NOTICE_BODY.slice(0, 2).map((para) => (
            <p key={para.slice(0, 24)} className="text-sm text-muted leading-relaxed">{para}</p>
          ))}
          <button
            onClick={() => setModalOpen(true)}
            className="text-sm text-accent-blue hover:underline underline-offset-2"
          >
            Read the full notice
          </button>
        </section>

        {/* What still works */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">What still works right now</h2>
          <p className="text-sm text-muted">These don&apos;t touch the stargazers list and never have.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {STILL_WORKING_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 p-3 rounded-lg border border-border bg-surface
                           hover:border-accent-blue/50 hover:bg-surface-alt transition-colors group min-h-11"
              >
                <span>
                  <span className="block text-sm font-medium text-foreground group-hover:text-accent-blue transition-colors">
                    {link.label}
                  </span>
                  <span className="block text-xs text-muted">{link.description}</span>
                </span>
                <ArrowRight size={14} className="shrink-0 text-muted-subtle" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>

        {/* Four ways forward / vote */}
        <section className="space-y-4">
          <h2 id="roadmap-vote-heading" className="text-sm font-semibold text-foreground uppercase tracking-wider">
            Four ways forward
          </h2>

          <div className="bg-surface-alt border border-border rounded-md p-4 text-sm text-muted space-y-2">
            <p>
              The four cards below are the ways StarMapper can move forward from here. Select any
              that apply, you can pick more than one, and submit when you&apos;re done.
            </p>
            <p>
              A, C and D are already decided, voting there just tells me which to build first and
              gives me a number to point to. B is the real fork in the road: it is the only option
              that would add real login and start storing your GitHub token, something StarMapper
              has never done. &quot;A plus C&quot; is the answer most people land on, not an edge
              case.
            </p>
          </div>

          <fieldset className="border-0 p-0 m-0">
            <legend className="sr-only">Which direction should StarMapper take? Select all that apply.</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {ROADMAP_OPTIONS.map((opt) => {
                const isSelected = selected.includes(opt.option);
                return (
                  <button
                    key={opt.option}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => toggle(opt.option)}
                    className={[
                      "relative flex flex-col gap-2 p-4 rounded-xl border text-left transition-colors min-h-11",
                      "focus:outline-none focus:ring-2 focus:ring-accent-blue/40",
                      isSelected ? "border-accent-blue bg-accent-blue/5" : "border-border bg-surface",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <StatusTag status={opt.status} label={opt.statusLabel} />
                      <span
                        className={[
                          "flex size-5 shrink-0 items-center justify-center rounded-full transition-opacity",
                          isSelected ? "bg-accent-blue opacity-100" : "opacity-0",
                        ].join(" ")}
                        aria-hidden="true"
                      >
                        <Check size={12} className="text-white" />
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-foreground">{opt.label}</span>
                    <span className="text-sm text-muted">{opt.sentence}</span>

                    {voted && (
                      <div className="pt-2 space-y-1">
                        <div className="w-full h-1.5 rounded-full bg-surface-alt overflow-hidden">
                          <div
                            className={opt.status === "decided" ? "h-full rounded-full bg-accent-green" : "h-full rounded-full bg-accent-blue"}
                            style={{ width: `${pct(opt.option)}%` }}
                          />
                        </div>
                        <span className="tabular-nums text-muted-subtle text-xs">
                          {pct(opt.option)}% · {tallies.tallies[opt.option]} votes
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {voted && (
            <p className="text-xs text-muted-subtle">
              {tallies.totalVoters} votes so far. Multi-select, so these add up to more than 100%.
            </p>
          )}

          <div className="flex items-center gap-3 pt-4">
            <button
              type="button"
              onClick={() => setContactModalOpen(true)}
              disabled={selected.length === 0 || submitting}
              className="w-full sm:w-auto bg-accent-green text-white font-semibold px-4 py-2 rounded-md
                         text-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed
                         focus:outline-none focus:ring-2 focus:ring-accent-blue/40"
            >
              {submitting ? "Submitting…" : voted ? "Update my vote" : "Submit my vote"}
            </button>
            <span aria-live="polite" className="text-sm text-muted">{feedback}</span>
          </div>
        </section>

        {/* Footer links */}
        <section className="space-y-2 pt-2 border-t border-border-subtle">
          <p className="text-xs font-semibold text-muted-subtle uppercase tracking-wide">Official sources</p>
          {STARGAZER_NOTICE_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-sm text-accent-blue hover:underline"
            >
              {link.label}
            </a>
          ))}
        </section>
      </main>

      <Footer />
    </>
  );
};

export default RoadmapPageClient;
