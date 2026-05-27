// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { TourId } from "@/lib/tour-storage";
import { isTourCompleted, markTourCompleted } from "@/lib/tour-storage";
import { TOUR_DEFINITIONS } from "@/lib/tour-steps";
import type { TourStep } from "@/lib/tour-steps";
import { TourOverlay } from "@/components/tour/tour-overlay";

type TourContextValue = {
  active: boolean;
  tourId: TourId | null;
  currentStep: number;
  totalSteps: number;
  currentStepData: TourStep | null;
  startTour: (id: TourId) => void;
  next: () => void;
  prev: () => void;
  skip: () => void;
};

export const TourContext = createContext<TourContextValue | null>(null);

const resolveSteps = (id: TourId): TourStep[] => {
  const def = TOUR_DEFINITIONS[id];
  return def.steps.filter((step) => {
    if (!step.optional) return true;
    if (typeof document === "undefined") return true;
    return !!document.querySelector(step.selector);
  });
};

export const TourProvider = ({ children }: { children: React.ReactNode }) => {
  const [tourId, setTourId] = useState<TourId | null>(null);
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const stepsRef = useRef<TourStep[]>([]);

  const active = tourId !== null && steps.length > 0;

  const startTour = useCallback((id: TourId) => {
    const resolved = resolveSteps(id);
    if (resolved.length === 0) return;
    stepsRef.current = resolved;
    setSteps(resolved);
    setCurrentStep(0);
    setTourId(id);
  }, []);

  const skip = useCallback(() => {
    if (tourId) markTourCompleted(tourId);
    setTourId(null);
    setSteps([]);
    setCurrentStep(0);
  }, [tourId]);

  const next = useCallback(() => {
    setCurrentStep((prev) => {
      if (prev >= stepsRef.current.length - 1) {
        if (tourId) markTourCompleted(tourId);
        setTourId(null);
        setSteps([]);
        return 0;
      }
      return prev + 1;
    });
  }, [tourId]);

  const prev = useCallback(() => {
    setCurrentStep((p) => Math.max(0, p - 1));
  }, []);

  const currentStepData = active && steps[currentStep] ? steps[currentStep] : null;

  // Keyboard navigation
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") skip();
      if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); next(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [active, skip, next, prev]);

  const ctx: TourContextValue = {
    active,
    tourId,
    currentStep,
    totalSteps: steps.length,
    currentStepData,
    startTour,
    next,
    prev,
    skip,
  };

  return (
    <TourContext.Provider value={ctx}>
      {children}
      {active && currentStepData && (
        <TourOverlay
          step={currentStepData}
          currentIndex={currentStep}
          totalSteps={steps.length}
          onNext={next}
          onPrev={prev}
          onSkip={skip}
        />
      )}
    </TourContext.Provider>
  );
};

// Thin wrapper that auto-starts on the landing page (first visit only)
export const LandingTourAutoStart = () => {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (isTourCompleted("landing")) return;
    const t = setTimeout(() => setShown(true), 1000);
    return () => clearTimeout(t);
  }, []);

  if (!shown) return null;
  return <LandingTourPrompt onDismiss={() => setShown(false)} />;
};

// Auto-starts the map tour after scan completes (first scan only)
type MapTourAutoStartProps = { status: string; hasPoints: boolean };

export const MapTourAutoStart = ({ status, hasPoints }: MapTourAutoStartProps) => {
  const [shown, setShown] = useState(false);
  const triggered = useRef(false);

  useEffect(() => {
    if (triggered.current) return;
    if (!hasPoints) return;
    if (status !== "done" && status !== "cached") return;
    if (isTourCompleted("map")) return;
    triggered.current = true;
    const t = setTimeout(() => setShown(true), 1500);
    return () => clearTimeout(t);
  }, [status, hasPoints]);

  if (!shown) return null;
  return <MapTourPrompt onDismiss={() => setShown(false)} />;
};

const MapTourPrompt = ({ onDismiss }: { onDismiss: () => void }) => {
  const { startTour } = useContext(TourContext)!;

  const handleStart = () => {
    onDismiss();
    startTour("map");
  };

  const handleSkip = () => {
    markTourCompleted("map");
    onDismiss();
  };

  return (
    <div
      role="dialog"
      aria-label="Discover map features"
      className="fixed bottom-24 left-4 z-40 w-72 bg-surface border border-border rounded-xl
                 shadow-2xl p-4 animate-in slide-in-from-bottom-4 fade-in duration-300"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-foreground">Discover the map features</p>
          <p className="text-xs text-muted leading-relaxed">
            There are 8 tools hidden in this interface. Want a quick walkthrough?
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleStart}
            className="flex-1 text-xs font-semibold px-3 py-1.5 rounded-md
                       bg-accent-blue text-white hover:opacity-90 transition-opacity"
          >
            Show me
          </button>
          <button
            onClick={handleSkip}
            className="text-xs text-muted hover:text-foreground transition-colors px-2 py-1.5"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
};

const LandingTourPrompt = ({ onDismiss }: { onDismiss: () => void }) => {
  const { startTour } = useContext(TourContext)!;

  const handleStart = () => {
    onDismiss();
    startTour("landing");
  };

  const handleSkip = () => {
    markTourCompleted("landing");
    onDismiss();
  };

  return (
    <div
      role="dialog"
      aria-label="Take a quick tour"
      className="fixed bottom-6 left-6 z-40 w-72 bg-surface border border-border rounded-xl
                 shadow-2xl p-4 animate-in slide-in-from-bottom-4 fade-in duration-300"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-foreground">New here?</p>
          <p className="text-xs text-muted leading-relaxed">
            Take a 30-second tour to discover what StarMapper can do.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleStart}
            className="flex-1 text-xs font-semibold px-3 py-1.5 rounded-md
                       bg-accent-blue text-white hover:opacity-90 transition-opacity"
          >
            Show me
          </button>
          <button
            onClick={handleSkip}
            className="text-xs text-muted hover:text-foreground transition-colors px-2 py-1.5"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
};
