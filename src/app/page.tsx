"use client";

import React, { useState } from "react";
import { Sparkles, RefreshCw, Compass, Laptop, CloudRain, Car, Volume2, Zap, ArrowRight } from "lucide-react";
import PrioritiesPanel, { UserPriorities } from "@/components/PrioritiesPanel";
import ChatInterface, { Message } from "@/components/ChatInterface";

export default function Home() {
  const [priorities, setPriorities] = useState<UserPriorities>({
    workFromHome: false,
    floodSensitive: false,
    commuteStress: false,
    noiseSensitive: false,
    powerReliability: false
  });

  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasStartedChat, setHasStartedChat] = useState(false);
  const [isMobilePanelOpen, setIsMobilePanelOpen] = useState(false);
  const [scoutMode, setScoutMode] = useState<"live" | "mock" | null>(null);

  // Quick actions mapping to predefined queries
  const quickActions = [
    { text: "Good for remote work?", query: "Which parts of Yaba or Lekki have the best internet and power for remote work?" },
    { text: "Flood risk?", query: "Which areas in Lekki and Ajah flood the worst during the rainy season?" },
    { text: "Power reliability?", query: "How is electricity grid stability around Chevron Drive and Ikeja GRA?" },
    { text: "Traffic stress?", query: "What is the daily traffic situation from Ogudu GRA to the Island?" },
    { text: "Quiet area?", query: "Where are the quietest residential closes in Ikeja and Surulere?" },
    { text: "Commute difficulty?", query: "How difficult is the commute along Herbert Macaulay Way during rush hour?" }
  ];

  const handleSendMessage = async (text: string) => {
    setHasStartedChat(true);
    setIsMobilePanelOpen(false);

    // Create user message
    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: text
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      // Map Message format to API format
      const apiHistory = newMessages.map(m => ({
        role: m.role,
        content: m.content
      }));

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: text,
          history: apiHistory.slice(0, -1), // exclude current message
          priorities
        })
      });

      if (!response.ok) {
        throw new Error("Failed to fetch response");
      }

      // Read headers for metadata
      const mode = response.headers.get("X-EkoScout-Mode") || "mock";
      setScoutMode(mode as "live" | "mock");

      const locationHeader = response.headers.get("X-EkoScout-Location");
      let matchedLocation = undefined;
      if (locationHeader) {
        try {
          matchedLocation = JSON.parse(decodeURIComponent(locationHeader));
        } catch (e) {
          console.error("Failed to parse matched location:", e);
        }
      }

      // Add empty assistant message that we will stream content into
      const assistantMessageId = (Date.now() + 1).toString();
      const initialAssistantMsg: Message = {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        location: matchedLocation
      };
      
      setMessages(prev => [...prev, initialAssistantMsg]);
      setIsLoading(false); // Stop typing bubble as streaming starts

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) {
        throw new Error("Response body is not readable");
      }

      let accumulatedContent = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        accumulatedContent += chunk;

        // Update assistant message with the accumulated content in real-time
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMessageId
              ? { ...m, content: accumulatedContent }
              : m
          )
        );
      }
    } catch (error) {
      console.error("Error communicating with EkoScout AI:", error);
      
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "Sorry, I had trouble reaching the Lagos database. Please check your connection and try again."
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    setHasStartedChat(false);
    setIsMobilePanelOpen(false);
    setScoutMode(null);
  };

  const activePrioritiesCount = Object.values(priorities).filter(Boolean).length;

  return (
    <div className="relative flex flex-col flex-1 min-h-screen bg-zinc-950 text-zinc-100 selection:bg-emerald-500 selection:text-black overflow-hidden">
      {/* Background Mesh Gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(16,185,129,0.08),rgba(255,255,255,0))] pointer-events-none" />

      {/* Header */}
      <header className="sticky top-0 z-30 flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md">
        <div className="flex items-center gap-2 cursor-pointer" onClick={handleClearChat}>
          <div className="p-1.5 rounded-lg bg-emerald-600/10 border border-emerald-500/20 text-emerald-500">
            <Compass size={20} />
          </div>
          <div>
            <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-zinc-100 to-zinc-400 bg-clip-text text-transparent">
              EkoScout
            </span>
            <span className="text-[10px] text-emerald-500 font-semibold block leading-none">
              Lagos Living Auditor
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {scoutMode && (
            <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-semibold border flex items-center gap-1.5 ${
              scoutMode === "live"
                ? "bg-emerald-950/40 text-emerald-400 border-emerald-800/80"
                : "bg-zinc-900/40 text-zinc-400 border-zinc-800"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${scoutMode === "live" ? "bg-emerald-500 animate-pulse" : "bg-zinc-500"}`} />
              {scoutMode === "live" ? "Live Data" : "Mock Mode"}
            </span>
          )}
          {hasStartedChat && (
            <button
              onClick={handleClearChat}
              className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/30 transition-all cursor-pointer"
            >
              <RefreshCw size={12} /> New Audit
            </button>
          )}
          <a
            href="https://github.com/eko-scout"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg border border-zinc-800 bg-zinc-900/20 text-zinc-400 hover:text-zinc-200 transition-all cursor-pointer"
            aria-label="GitHub Repository"
          >
            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
              <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
            </svg>
          </a>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 max-w-7xl w-full mx-auto p-4 sm:p-6 overflow-hidden">
        {!hasStartedChat ? (
          /* Landing Screen */
          <div className="flex-1 flex flex-col justify-center items-center py-6 sm:py-12 max-w-4xl mx-auto w-full animate-fade-in space-y-8 sm:space-y-12">
            
            {/* Title / Intro */}
            <div className="text-center space-y-4 max-w-2xl">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold tracking-widest uppercase text-emerald-500 bg-emerald-950/40 border border-emerald-900/40 px-2.5 py-1 rounded-full">
                <Sparkles size={10} /> Smart Hyperlocal Living Conditions
              </span>
              <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
                Ask what living anywhere in <span className="bg-gradient-to-r from-emerald-400 to-teal-500 bg-clip-text text-transparent">Lagos</span> is actually like.
              </h1>
              <p className="text-sm sm:text-base text-zinc-400 max-w-xl mx-auto leading-relaxed">
                Get practical insights about internet reliability, flooding, traffic stress, power stability, and noise levels before wasting time on physical inspections.
              </p>
            </div>

            {/* Config & Quick Search Box */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-6 w-full items-start">
              
              {/* Profile Configurator (Left 2 cols) */}
              <div className="md:col-span-2 space-y-3">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block">
                  Step 1: Customize Your Priorities
                </span>
                <PrioritiesPanel
                  priorities={priorities}
                  onChange={setPriorities}
                  className="shadow-xl shadow-emerald-950/5"
                />
              </div>

              {/* Instant Search Box (Right 3 cols) */}
              <div className="md:col-span-3 space-y-6">
                <div className="space-y-3">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block">
                    Step 2: Ask about a Location or Street
                  </span>
                  
                  {/* Central Text Input */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const target = e.currentTarget.elements.namedItem("search-input") as HTMLInputElement;
                      if (target?.value.trim()) {
                        handleSendMessage(target.value.trim());
                      }
                    }}
                    className="relative flex items-center"
                  >
                    <input
                      id="landing-search-input"
                      name="search-input"
                      type="text"
                      placeholder="Ask, e.g., 'How is Admiralty Way for remote work?'"
                      className="w-full py-4 pl-4 pr-14 rounded-2xl border border-zinc-800 bg-zinc-900/40 focus:border-emerald-500/80 focus:ring-1 focus:ring-emerald-500/20 text-sm sm:text-base text-zinc-200 placeholder-zinc-500 outline-none transition-all shadow-lg shadow-black/20"
                    />
                    <button
                      type="submit"
                      id="landing-search-btn"
                      className="absolute right-2.5 p-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-md shadow-emerald-900/20 cursor-pointer"
                    >
                      <ArrowRight size={18} />
                    </button>
                  </form>
                </div>

                {/* Quick Actions Grid */}
                <div className="space-y-3">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block">
                    Suggested Quick Audits
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {quickActions.map((action, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleSendMessage(action.query)}
                        className="p-3 text-xs text-left text-zinc-300 font-semibold border border-zinc-800/80 bg-zinc-900/10 hover:bg-zinc-900/40 hover:border-zinc-700 rounded-xl transition-all flex items-center justify-between group cursor-pointer"
                      >
                        <span>{action.text}</span>
                        <ArrowRight size={12} className="text-zinc-500 group-hover:text-emerald-500 group-hover:translate-x-0.5 transition-all" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Informational Badges */}
            <div className="flex flex-wrap items-center justify-center gap-6 text-zinc-500 text-xs border-t border-zinc-900 pt-8 w-full">
              <span className="flex items-center gap-1.5"><Laptop size={14} className="text-emerald-500" /> Internet & Wifi Audit</span>
              <span className="flex items-center gap-1.5"><CloudRain size={14} className="text-blue-400" /> Drainage & Flood Warnings</span>
              <span className="flex items-center gap-1.5"><Zap size={14} className="text-yellow-400" /> Grid Power Stability</span>
              <span className="flex items-center gap-1.5"><Car size={14} className="text-amber-400" /> Commute & Traffic Stress</span>
              <span className="flex items-center gap-1.5"><Volume2 size={14} className="text-purple-400" /> Ambient Noise Profile</span>
            </div>

          </div>
        ) : (
          /* Active Chat Screen */
          <div className="flex-1 flex flex-col md:flex-row gap-6 overflow-hidden min-h-[450px]">
            
            {/* Left Column: Priorities Profile (Desktop only, hidden/modal-like on mobile) */}
            <div className="hidden md:flex md:w-[320px] flex-col shrink-0">
              <div className="sticky top-24">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">
                  My Profile Filters
                </span>
                <PrioritiesPanel
                  priorities={priorities}
                  onChange={setPriorities}
                  className="shadow-xl"
                />
              </div>
            </div>

            {/* Mobile collapsible filters header */}
            <div className="md:hidden flex flex-col gap-2 shrink-0">
              <button
                onClick={() => setIsMobilePanelOpen(!isMobilePanelOpen)}
                className="flex items-center justify-between px-4 py-3 rounded-xl border border-zinc-800 bg-zinc-900/60 text-xs font-semibold text-zinc-300 cursor-pointer"
              >
                <span>My Profile Preferences ({activePrioritiesCount} active)</span>
                <span className="text-emerald-500 text-[10px] font-bold uppercase">
                  {isMobilePanelOpen ? "Close Filters" : "Tap to Adjust"}
                </span>
              </button>

              {isMobilePanelOpen && (
                <div className="animate-fade-in z-20">
                  <PrioritiesPanel
                    priorities={priorities}
                    onChange={setPriorities}
                    className="shadow-2xl border-emerald-500/10"
                  />
                </div>
              )}
            </div>

            {/* Right Column: Chat Interface */}
            <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
              <ChatInterface
                messages={messages}
                isLoading={isLoading}
                onSendMessage={handleSendMessage}
                priorities={priorities}
                className="shadow-xl"
              />
            </div>
            
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="py-4 px-6 border-t border-zinc-900 text-center text-[10px] text-zinc-600 bg-zinc-950 shrink-0">
        <p>&copy; {new Date().getFullYear()} EkoScout &bull; Hyperlocal Living Intelligence for Lagos, Nigeria.</p>
      </footer>
    </div>
  );
}
