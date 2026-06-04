"use client";

import React from "react";
import { Laptop, CloudRain, Car, Volume2, Zap } from "lucide-react";

export interface UserPriorities {
  workFromHome: boolean;
  floodSensitive: boolean;
  commuteStress: boolean;
  noiseSensitive: boolean;
  powerReliability: boolean;
}

interface PrioritiesPanelProps {
  priorities: UserPriorities;
  onChange: (newPriorities: UserPriorities) => void;
  className?: string;
}

export default function PrioritiesPanel({ priorities, onChange, className = "" }: PrioritiesPanelProps) {
  const togglePriority = (key: keyof UserPriorities) => {
    onChange({
      ...priorities,
      [key]: !priorities[key]
    });
  };

  const priorityItems = [
    {
      key: "workFromHome" as const,
      label: "Remote Worker",
      description: "Needs stable fiber/5G internet and consistent power.",
      icon: Laptop,
      colorClass: "text-emerald-400 bg-emerald-950/40 border-emerald-900/50"
    },
    {
      key: "floodSensitive" as const,
      label: "Flood Sensitive",
      description: "Waterlogging is a complete dealbreaker for you.",
      icon: CloudRain,
      colorClass: "text-blue-400 bg-blue-950/40 border-blue-900/50"
    },
    {
      key: "commuteStress" as const,
      label: "Hate Traffic",
      description: "Needs fast commutes, bridges connection, and transport options.",
      icon: Car,
      colorClass: "text-amber-400 bg-amber-950/40 border-amber-900/50"
    },
    {
      key: "noiseSensitive" as const,
      label: "Noise Sensitive",
      description: "Prefers quiet spaces, away from clubs, markets, or traffic.",
      icon: Volume2,
      colorClass: "text-purple-400 bg-purple-950/40 border-purple-900/50"
    },
    {
      key: "powerReliability" as const,
      label: "Reliable Power",
      description: "Needs premium grids (Band A) or active estate backup generators.",
      icon: Zap,
      colorClass: "text-yellow-400 bg-yellow-950/40 border-yellow-900/50"
    }
  ];

  return (
    <div className={`flex flex-col gap-4 p-5 rounded-2xl border border-zinc-800 bg-zinc-900/50 backdrop-blur-md ${className}`}>
      <div>
        <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">
          My Living Profile
        </h3>
        <p className="text-xs text-zinc-500 mt-1">
          EkoScout filters and reviews locations based on what matters to you.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {priorityItems.map((item) => {
          const Icon = item.icon;
          const isActive = priorities[item.key];

          return (
            <button
              key={item.key}
              id={`priority-toggle-${item.key}`}
              onClick={() => togglePriority(item.key)}
              className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-all duration-200 cursor-pointer ${
                isActive
                  ? `${item.colorClass} border-opacity-100 ring-1 ring-white/10 shadow-lg shadow-black/10`
                  : "border-zinc-800 bg-zinc-900/20 hover:border-zinc-700 text-zinc-400 hover:text-zinc-300"
              }`}
            >
              <div
                className={`p-2 rounded-lg ${
                  isActive ? "bg-black/20" : "bg-zinc-800"
                }`}
              >
                <Icon size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{item.label}</span>
                  <div
                    className={`w-8 h-4 rounded-full p-0.5 transition-colors duration-200 ${
                      isActive ? "bg-current" : "bg-zinc-700"
                    }`}
                  >
                    <div
                      className={`w-3 h-3 rounded-full bg-zinc-950 transition-transform duration-200 ${
                        isActive ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </div>
                </div>
                <p className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">
                  {item.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
