"use client";

import { useState, useId } from "react";

type Tab<T extends string> = {
  id: T;
  label: string;
  count?: number;
};

type TabsProps<T extends string> = {
  tabs: Tab<T>[];
  activeTab: T;
  onChange: (tab: T) => void;
  className?: string;
};

export const Tabs = <T extends string>({
  tabs,
  activeTab,
  onChange,
  className = "",
}: TabsProps<T>) => {
  const id = useId();

  return (
    <div
      role="tablist"
      aria-label="Content tabs"
      className={`flex overflow-x-auto snap-x snap-mandatory gap-1 border-b border-border-subtle pb-0 scrollbar-none ${className}`}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            role="tab"
            id={`${id}-tab-${tab.id}`}
            aria-selected={isActive}
            aria-controls={`${id}-panel-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={[
              "flex shrink-0 snap-start items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors",
              "border-b-2 -mb-px whitespace-nowrap",
              isActive
                ? "border-accent-blue text-foreground"
                : "border-transparent text-muted hover:text-foreground",
            ].join(" ")}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="text-2xs tabular-nums bg-surface border border-border px-1.5 py-0.5 rounded-full text-muted-subtle">
                {tab.count.toLocaleString()}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

type TabPanelProps = {
  id: string;
  tabId: string;
  activeTab: string;
  children: React.ReactNode;
};

export const TabPanel = ({ id, tabId, activeTab, children }: TabPanelProps) => (
  <div
    role="tabpanel"
    id={`${id}-panel-${tabId}`}
    aria-labelledby={`${id}-tab-${tabId}`}
    hidden={tabId !== activeTab}
  >
    {tabId === activeTab ? children : null}
  </div>
);

export const useTabs = <T extends string>(initial: T) => {
  const [activeTab, setActiveTab] = useState<T>(initial);
  return { activeTab, setActiveTab };
};
