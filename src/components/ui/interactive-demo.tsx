"use client";

import React, { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { UploadCloud, FileAudio, FileText, CheckCircle2, AlertCircle, Loader2, Sparkles, Lock, ArrowRight, LayoutTemplate } from "lucide-react";

type DemoState = "idle" | "error_duration" | "error_limit" | "processing" | "success";

interface MockResult {
    title: string;
    date: string;
    summary: string;
    actionItems: { assignee: string; task: string; dueDate: string }[];
}

export function InteractiveDemo() {
    const [state, setState] = useState<DemoState>("idle");
    const [errorMessage, setErrorMessage] = useState("");
    const [progressMsg, setProgressMsg] = useState("");
    const [result, setResult] = useState<MockResult | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const templateInputRef = useRef<HTMLInputElement>(null);

    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [selectedTemplate, setSelectedTemplate] = useState<File | null>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, isTemplate: boolean = false) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (isTemplate) {
            setSelectedTemplate(file);
            return;
        }

        setSelectedFile(file);
        setState("idle");
        setErrorMessage("");

        // Check duration for audio/video
        if (file.type.startsWith("audio/") || file.type.startsWith("video/")) {
            const url = URL.createObjectURL(file);
            const audio = new Audio(url);

            audio.onloadedmetadata = () => {
                URL.revokeObjectURL(url);
                if (audio.duration > 300) { // 300 seconds = 5 minutes
                    setState("error_duration");
                    setErrorMessage("Recording exceeds 5 minutes. Please log in to process longer meetings (up to 2 hours per meeting on Pro).");
                }
            };

            audio.onerror = () => {
                // If we can't read duration, we assume it's fine for the mock
                URL.revokeObjectURL(url);
            };
        } else {
            // If it's a docx/txt, check file size as a proxy for "length" (e.g. > 2MB is quite long for a transcript text)
            if (file.size > 2 * 1024 * 1024) {
                setState("error_duration");
                setErrorMessage("Transcript file is too large. Please log in to process larger documents.");
            }
        }
    };

    const handleGenerate = async () => {
        if (!selectedFile) return;
        if (state === "error_duration") return;

        setState("processing");
        setProgressMsg("Uploading securely...");

        // Simulate upload
        await new Promise(r => setTimeout(r, 1000));
        setProgressMsg("AI is transcribing audio...");

        try {
            const res = await fetch("/api/demo/generate", {
                method: "POST",
            });

            const data = await res.json();

            if (!res.ok) {
                setState("error_limit");
                setErrorMessage(data.message || "An error occurred.");
                return;
            }

            setProgressMsg("Structuring action items...");
            await new Promise(r => setTimeout(r, 1200));

            setResult(data.data);
            setState("success");
        } catch (err) {
            setState("error_limit");
            setErrorMessage("Network error. Please try again.");
        }
    };

    const reset = () => {
        setSelectedFile(null);
        setSelectedTemplate(null);
        setState("idle");
        setResult(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        if (templateInputRef.current) templateInputRef.current.value = "";
    };

    return (
        <div className="w-full max-w-4xl mx-auto bg-white rounded-3xl shadow-xl ring-1 ring-slate-200/60 overflow-hidden">
            {/* Top Bar */}
            <div className="bg-slate-50 border-b border-slate-100 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-emerald-600" />
                    <h3 className="font-semibold text-slate-800">Live AI Demo</h3>
                </div>
                <div className="text-xs font-medium px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full">
                    Free Trial Mode
                </div>
            </div>

            <div className="p-8 md:p-12">
                <AnimatePresence mode="wait">

                    {/* IDLE / ERROR STATE */}
                    {(state === "idle" || state.includes("error")) && (
                        <motion.div
                            key="idle"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.98 }}
                            className="space-y-8"
                        >
                            <div className="grid md:grid-cols-2 gap-6">
                                {/* Main File Dropzone */}
                                <div
                                    onClick={() => fileInputRef.current?.click()}
                                    className={`relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${selectedFile ? "border-emerald-500 bg-emerald-50" : "border-slate-300 hover:border-emerald-400 hover:bg-slate-50"
                                        }`}
                                >
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        onChange={(e) => handleFileChange(e, false)}
                                        className="hidden"
                                        accept="audio/*,video/*,.txt,.docx"
                                    />

                                    {selectedFile ? (
                                        <div className="flex flex-col items-center gap-2">
                                            <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-700 mb-2">
                                                <FileAudio className="w-6 h-6" />
                                            </div>
                                            <p className="font-semibold text-slate-800 truncate w-full px-4">{selectedFile.name}</p>
                                            <p className="text-sm text-emerald-600 font-medium">Ready to process</p>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center gap-2">
                                            <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-500 mb-2">
                                                <UploadCloud className="w-6 h-6" />
                                            </div>
                                            <p className="font-medium text-slate-700">Upload Meeting Audio or Transcript</p>
                                            <p className="text-xs text-slate-500">MP3, WAV, DOCX or TXT (Max 5 mins)</p>
                                        </div>
                                    )}
                                </div>

                                {/* Template Dropzone */}
                                <div
                                    onClick={() => templateInputRef.current?.click()}
                                    className={`relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${selectedTemplate ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                                        }`}
                                >
                                    <input
                                        type="file"
                                        ref={templateInputRef}
                                        onChange={(e) => handleFileChange(e, true)}
                                        className="hidden"
                                        accept=".docx,.pdf"
                                    />

                                    {selectedTemplate ? (
                                        <div className="flex flex-col items-center gap-2">
                                            <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-700 mb-2">
                                                <LayoutTemplate className="w-6 h-6" />
                                            </div>
                                            <p className="font-semibold text-slate-800 truncate w-full px-4">{selectedTemplate.name}</p>
                                            <p className="text-sm text-emerald-600 font-medium">Template Applied</p>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center gap-2">
                                            <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center text-slate-400 mb-2">
                                                <FileText className="w-6 h-6" />
                                            </div>
                                            <p className="font-medium text-slate-600">Attach Previous Template <span className="text-slate-400 font-normal">(Optional)</span></p>
                                            <p className="text-xs text-slate-400">Match your company's MoM format</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Errors */}
                            <AnimatePresence>
                                {state.includes("error") && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: "auto" }}
                                        className="bg-red-50 text-red-800 p-4 rounded-xl flex items-start gap-3 border border-red-100"
                                    >
                                        <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                                        <div className="text-sm leading-relaxed">
                                            <p className="font-semibold mb-1">Action Required</p>
                                            {errorMessage}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Action */}
                            <div className="flex items-center justify-end border-t border-slate-100 pt-6 mt-6">
                                <button
                                    onClick={handleGenerate}
                                    disabled={!selectedFile || state === "error_duration"}
                                    className="flex items-center gap-2 bg-emerald-700 text-white px-8 py-3.5 rounded-full font-semibold shadow-sm hover:bg-emerald-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                                >
                                    Generate Minutes
                                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                                </button>
                            </div>
                        </motion.div>
                    )}

                    {/* PROCESSING STATE */}
                    {state === "processing" && (
                        <motion.div
                            key="processing"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="py-20 flex flex-col items-center justify-center text-center space-y-6"
                        >
                            <div className="relative">
                                <div className="absolute inset-0 bg-emerald-400 blur-2xl opacity-20 animate-pulse rounded-full"></div>
                                <div className="w-20 h-20 bg-emerald-50 rounded-2xl flex items-center justify-center ring-1 ring-emerald-100 relative">
                                    <Loader2 className="w-10 h-10 text-emerald-600 animate-spin" />
                                </div>
                            </div>
                            <div>
                                <h3 className="text-xl font-semibold text-slate-900 mb-2">Analyzing Meeting</h3>
                                <p className="text-slate-500 animate-pulse">{progressMsg}</p>
                            </div>
                        </motion.div>
                    )}

                    {/* SUCCESS STATE */}
                    {state === "success" && result && (
                        <motion.div
                            key="success"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                        >
                            <div className="flex items-center justify-between mb-8 border-b border-slate-100 pb-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-700">
                                        <CheckCircle2 className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-slate-900 text-lg">Generation Complete</h3>
                                        <p className="text-sm text-slate-500">Took 3.5s • Bank-grade encrypted</p>
                                    </div>
                                </div>
                                <button onClick={reset} className="text-sm font-medium text-slate-500 hover:text-slate-900">
                                    Start Over
                                </button>
                            </div>

                            {/* Mock Result Document */}
                            <div className="bg-slate-50 rounded-2xl p-8 border border-slate-200 relative overflow-hidden">
                                <div className="max-w-2xl mx-auto space-y-6">
                                    <div className="text-center border-b border-slate-200 pb-6 mb-6">
                                        <h1 className="text-2xl font-bold text-slate-900 mb-2">{result.title}</h1>
                                        <p className="text-sm text-slate-500">Date: {new Date(result.date).toLocaleDateString()}</p>
                                    </div>

                                    <div>
                                        <h4 className="font-bold text-slate-800 text-sm uppercase tracking-wider mb-2">Executive Summary</h4>
                                        <p className="text-slate-700 leading-relaxed text-sm">
                                            {result.summary}
                                        </p>
                                    </div>

                                    <div>
                                        <h4 className="font-bold text-slate-800 text-sm uppercase tracking-wider mb-4 mt-6">Action Items</h4>
                                        <div className="space-y-3">
                                            {result.actionItems.map((item, i) => (
                                                <div key={i} className="flex items-start gap-4 p-4 bg-white rounded-xl shadow-sm border border-slate-100">
                                                    <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 font-bold flex items-center justify-center text-sm shrink-0">
                                                        {item.assignee.charAt(0)}
                                                    </div>
                                                    <div>
                                                        <p className="font-medium text-slate-900 text-sm">{item.task}</p>
                                                        <div className="flex items-center gap-3 mt-1 text-xs font-medium text-slate-500">
                                                            <span>Assignee: {item.assignee}</span>
                                                            <span className="text-slate-300">•</span>
                                                            <span className="text-emerald-600">Due: {item.dueDate}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* Blur Overlay & Upsell */}
                                <div className="absolute bottom-0 left-0 w-full h-48 bg-gradient-to-t from-white via-white/90 to-transparent flex items-end justify-center pb-8 z-10">
                                    <div className="bg-white px-8 py-5 rounded-2xl shadow-xl ring-1 ring-slate-200/50 flex flex-col items-center gap-4 animate-[bounce_2s_infinite]">
                                        <p className="font-bold text-slate-800 flex items-center gap-2">
                                            <Lock className="w-4 h-4 text-emerald-600" /> Unlock the rest of the document
                                        </p>
                                        <div className="flex gap-3 w-full">
                                            <button className="flex-1 bg-slate-900 text-white px-6 py-2.5 rounded-full text-sm font-semibold hover:bg-slate-800 transition-colors">
                                                Sign Up to Export
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}

                </AnimatePresence>
            </div>
        </div>
    );
}
