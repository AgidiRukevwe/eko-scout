"use client";

import React, { useState } from "react";
import { LocationData } from "@/lib/lagosData";
import { 
  Wifi, 
  Zap, 
  CloudRain, 
  Car, 
  Volume2, 
  ShieldCheck, 
  ChevronDown, 
  ChevronUp, 
  Compass, 
  MapPin 
} from "lucide-react";

interface LocationCardProps {
  location: LocationData;
  className?: string;
}

export default function LocationCard({ location, className = "" }: LocationCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const { name, parentArea, scores, details } = location;

  const scoreItems = [
    {
      label: "Internet Quality",
      score: scores.internet,
      icon: Wifi,
      details: details.internet.status,
      breakdown: details.internet.breakdown,
      extra: `Recommended: ${details.internet.recommendedISPs.join(", ")}`
    },
    {
      label: "Power Stability",
      score: scores.power,
      icon: Zap,
      details: details.power.status,
      breakdown: details.power.breakdown,
      extra: `Billing: ${details.power.billing}`
    },
    {
      label: "Flood Resistance",
      score: scores.flooding,
      icon: CloudRain,
      details: details.flooding.status,
      breakdown: details.flooding.breakdown,
      extra: `Seasonality: ${details.flooding.seasonality}`
    },
    {
      label: "Commute Ease",
      score: scores.traffic,
      icon: Car,
      details: details.traffic.status,
      breakdown: details.traffic.breakdown,
      extra: `Peak hours: ${details.traffic.peakHours}`
    },
    {
      label: "Quietness",
      score: scores.noise,
      icon: Volume2,
      details: details.noise.status,
      breakdown: details.noise.breakdown,
      extra: `Sources: ${details.noise.sources.join(", ")}`
    },
    {
      label: "Safety & Security",
      score: scores.safety,
      icon: ShieldCheck,
      details: details.safety.status,
      breakdown: details.safety.breakdown,
      extra: `Type: ${details.safety.securityType}`
    }
  ];

  const getScoreColor = (score: number) => {
    if (score >= 4) return "bg-emerald-500 text-emerald-400";
    if (score === 3) return "bg-amber-500 text-amber-400";
    return "bg-rose-500 text-rose-400";
  };

  const getScoreText = (score: number) => {
    if (score >= 4) return "Good";
    if (score === 3) return "Fair";
    return "Poor";
  };

  return (
    <div className={`rounded-2xl border border-zinc-800 bg-zinc-900/40 backdrop-blur-md overflow-hidden ${className}`}>
      {/* Header */}
      <div className="p-5 border-b border-zinc-800/80 bg-zinc-900/20">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="text-emerald-500 shrink-0" size={18} />
            <div>
              <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest block">
                Matched Location
              </span>
              <h2 className="text-base font-bold text-zinc-100 mt-0.5">
                {name}
              </h2>
            </div>
          </div>
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700/60">
            {parentArea}
          </span>
        </div>
        
        <div className="flex items-center gap-2 mt-3 text-xs text-zinc-400 bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-800/40">
          <Compass className="text-emerald-500 shrink-0" size={14} />
          <p className="line-clamp-2 italic">
            &ldquo;{details.lifestyle.vibe}&rdquo;
          </p>
        </div>
      </div>

      {/* Grid of Scores */}
      <div className="p-5 flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {scoreItems.map((item, idx) => {
            const Icon = item.icon;
            const colorClass = getScoreColor(item.score);
            const labelColor = colorClass.split(" ")[1];

            return (
              <div key={idx} className="p-3 rounded-xl bg-zinc-950/40 border border-zinc-800/40 hover:border-zinc-800 transition-colors duration-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-zinc-300">
                    <Icon size={16} className="text-zinc-500" />
                    <span className="text-xs font-semibold">{item.label}</span>
                  </div>
                  <span className={`text-[10px] font-bold uppercase ${labelColor}`}>
                    {getScoreText(item.score)} ({item.score}/5)
                  </span>
                </div>
                
                {/* Progress bar */}
                <div className="w-full h-1.5 bg-zinc-800 rounded-full mt-2 overflow-hidden">
                  <div 
                    className={`h-full rounded-full ${colorClass.split(" ")[0]}`} 
                    style={{ width: `${(item.score / 5) * 100}%` }}
                  />
                </div>
                
                <span className="text-[10px] text-zinc-500 block mt-1.5 truncate">
                  {item.details}
                </span>
              </div>
            );
          })}
        </div>

        {/* Action Toggle */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl border border-zinc-800 bg-zinc-900/30 hover:bg-zinc-900/60 hover:border-zinc-700 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-all cursor-pointer"
        >
          {isExpanded ? (
            <>
              Hide Hyperlocal Specs <ChevronUp size={14} />
            </>
          ) : (
            <>
              Explore Hyperlocal Specs <ChevronDown size={14} />
            </>
          )}
        </button>

        {/* Expanded Info */}
        {isExpanded && (
          <div className="flex flex-col gap-4 pt-3 mt-1 border-t border-zinc-800/60 animate-fade-in">
            {scoreItems.map((item, idx) => {
              const Icon = item.icon;
              return (
                <div key={idx} className="flex gap-3 text-xs leading-relaxed">
                  <div className="mt-0.5 p-1.5 rounded-lg bg-zinc-800/80 border border-zinc-700/40 text-zinc-400 shrink-0">
                    <Icon size={14} />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-zinc-200">{item.label}</h4>
                    <p className="text-zinc-400 mt-0.5">{item.breakdown}</p>
                    <span className="text-[10px] text-emerald-500 font-medium mt-1 block">
                      {item.extra}
                    </span>
                  </div>
                </div>
              );
            })}
            
            <div className="p-3 rounded-xl bg-zinc-950/30 border border-zinc-800/60 mt-2 text-xs">
              <h4 className="font-semibold text-zinc-300">Other Specs:</h4>
              <ul className="list-disc list-inside text-zinc-400 mt-1 flex flex-col gap-1">
                <li>Walkability is rated as <span className="text-zinc-200 font-semibold">{details.lifestyle.walkability.toLowerCase()}</span>.</li>
                <li>{details.lifestyle.remoteWork}</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
