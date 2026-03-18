PRODUCT SPECIFICATION DOCUMENT (PSD)
Product Name: secretariat.my
Target Market: Enterprise Banks, GLICs, Public Listed Companies
Primary Users: Company Secretaries (CoSec), Legal & Compliance Operations (LCO)
Core Value Proposition: An "Agentic Doer" that automates the generation of highly accurate, agenda-specific board and committee minutes (e.g., ALCO, MRC) while adapting to enterprise security and formatting standards.

1. Executive Summary
The corporate board portal market is currently dominated by "Better Readers" like BoardPAC and Azeus Convene, which function primarily as secure PDF repositories. secretariat.my is designed as an "Agentic Doer". It automates the tedious, hours-long process of minute-taking by isolating discussion contexts by Agenda, cross-referencing decisions with presentation slides, and providing AI-driven editing tools (Dual-Chatbot) that dynamically maintain meeting context and formatting.
+2

2. System Architecture & Tech Stack (The Lean & Mean Setup)
To ensure fast performance, cost-effectiveness, and a fully custom user interface, the system utilizes a modern architecture without relying on third-party workflow engines.

Frontend & Backend: Next.js (Enables fast rendering and secure API integration within a unified framework).

AI Engine Connector: Vercel AI SDK (Connects the web application directly to the LLM with chat streaming support).


Core LLM (The Brain): Enterprise-grade models like Claude 3.5 Sonnet or OpenAI (via API), architected to support BYO-Model (Bring Your Own Model)  should banks require private LLM hosting.


Speech-to-Text Engine: OpenAI Whisper API (for high-quality transcription) paired with Pyannote.audio (for Speaker Diarization to distinguish between speakers).
+1

3. Data Ingestion (3-Mode Strategy)
To bypass bank IT bureaucracy while offering flexibility, the system supports three distinct data ingestion modes:

Mode 1: Manual Upload (Zero-Integration)

Users manually upload recording files (Video/Audio) and Slide files (PDF).

Users can either upload an existing transcript (e.g., .docx from Teams) OR let the built-in Speech-to-Text engine generate the transcript and detect speakers (Speaker A, Speaker B).

Mode 2: Teams Native Processing (No-Bot Policy)

The system does NOT use observer bots (like Otter.ai) that join meetings, adhering strictly to bank privacy and security policies.

Users upload the natively generated Microsoft Teams transcript, and the AI cleans up spelling and contextual errors within it.

Mode 3: Enterprise API Integration (Future Roadmap)

Direct integration using Microsoft Graph API.

The system silently pulls recording and transcript files directly from the company's OneDrive/SharePoint immediately after the meeting ends (requires Admin Consent from Bank IT).

4. The Core Workflow: User Journey
Phase 1: Agenda Structuring (Import & Setup)
Excel Import: Users upload a standard Excel template containing the meeting structure (Agenda No., Agenda Title, Presenter Name).

The system automatically generates visual "Agenda Blocks" on the dashboard.

Phase 2: Semantic Mapping (Highlight & Assign)
Users view the full transcript text on the left side of the screen.

Highlight-to-Assign: Users highlight blocks of conversation text and click "Assign to Agenda X".

This empowers the CoSec to neatly organize non-linear or jumping conversations into the correct Agenda block with precise timelines.

Phase 3: The 3-Prompt Execution Engine
Once data is assigned, the engine runs a three-step automation loop specifically for each individual agenda:

Prompt 1 (Context Cleaning): AI cleans the raw transcript for the specific agenda and extracts key points based on the timeline.

Prompt 2 (Cross-Reference): AI reads the Slide Presentation PDF linked to that exact agenda.

Prompt 3 (Synthesis & Formatting): AI analyzes "Outside Discussions" (verbal discussions not explicitly found in the slides) and synthesizes them into standard corporate minute formats (Noted, Discussed, Action Items).

Phase 4: Refinement & Dual-Chatbot Interface
Each completed Agenda block features a Dual-Chatbot UI next to the generated text:

Chatbot Ask (RAG Query): Acts as a quick contextual search. Users can ask, "At what minute did Member A object to this ratio?" and the AI will cross-reference the agenda's transcript.

Chatbot Change (Agentic Editing): Acts as an automated, targeted editor. Users input commands like "Change action item number 2 to passive voice" or "Summarize this discussion section". The AI only edits the targeted section without regenerating the entire minute.

5. Advanced Contextual Features (The "Secret Sauce")
A. ALCO Persona Injection (System Prompt)
To prevent AI hallucinations or misunderstandings of technical terms, the system utilizes a "Persona Prompt."

The AI is instructed behind the scenes: "You are a Senior LCO/CoSec for the Asset Liability Committee (ALCO). You understand banking contexts such as Liquidity Coverage Ratio (LCR), OPR, and fund risk management." This ensures the tone and terminology meet banking standards.

B. Dynamic Format Memory (Rolling Context)
Solves the issue of "AI Amnesia" between agenda items.

Format Prompt Box: Users can paste the format/structure from previous minutes (e.g., Agenda 8.1) into the prompt box for Agenda 8.2.

The system will automatically "mimic" and retain that structure (e.g., an Approval Paper format requiring Proposer & Seconder names), ensuring formatting consistency does not break from one agenda to the next.

6. Enterprise Security & Compliance (Bank-Grade Pitch)
To ensure the product passes stringent Bank IT and Risk assessments:

Data Isolation: ALCO conversation contexts are strictly excluded from fine-tuning public OpenAI/Claude models.


Decoupled Architecture Readiness: The system is architecturally prepared to support future enterprise phases, including a Zero-Egress Video Pipeline (processing video in local containers to ensure data never leaves the network) and BYOS (Bring Your Own Storage) for banks requiring absolute physical control over their data storage.

7. UI/UX Page Architecture & Screen Flow
The application will feature a clean, enterprise-grade, dual-pane interface designed to minimize cognitive load for the CoSec. Below is the breakdown of the specific pages and their core components.

Page 1: The Command Center (Main Dashboard)
Purpose: The landing page after login, acting as the central hub for all meetings.

Components:

Top Navbar: User Profile, Organization Switcher (e.g., switch between ALCO, MRC, Board of Directors).

"New Meeting" CTA: A prominent button to initiate a new minute-taking session.

Meeting Database List: A data table displaying all meetings with columns for: Meeting Title, Date, Committee (ALCO/MRC), and Status (Pending Setup / In Progress / Finalized).

Page 2: Meeting Setup & Ingestion (The "Dropzone")
Purpose: The data entry point for Mode 1 & 2 before the AI processing begins.

Components:

Step 1 (Agenda Import): A drag-and-drop zone specifically for the Excel Agenda template.

Step 2 (Media Upload): Dropzones for the Video/Audio recording AND/OR the raw Microsoft Teams Transcript (.docx / .vtt).


Step 3 (Slide Upload): A dropzone for the consolidated Slide Deck (PDF).

Action Button: "Proceed to Mapping".

Page 3: The Semantic Mapper (Highlight & Assign)
Purpose: The interface where the CoSec manually tags conversation chunks to specific agenda items.

Layout (Split Screen):

Left Pane (Raw Transcript): Displays the full, scrolling text of the meeting transcript (with speaker names if available). Text is selectable/highlightable.

Right Pane (Agenda Blocks): Displays empty "cards" for each Agenda item (generated from the Excel import).

Interaction Flow: User highlights a paragraph on the Left Pane -> A tooltip appears -> User clicks "Assign to Agenda X" -> The text is routed to the corresponding card on the Right Pane.

Action Button: "Generate Minutes" (Triggers the 3-Prompt n8n/Next.js Engine).

Page 4: The Agentic Editor (The Core Workspace)
Purpose: The most important page. This is where the CoSec reviews the AI-generated minutes and uses the Dual-Chatbot for refinement.

Layout (Split Screen - Agenda by Agenda View):

Top Bar (Rolling Context): A dropdown or text box labeled "Format Prompt" where the CoSec can paste a specific format (e.g., "Use Approval Paper format") for the current agenda.

Left Pane (Generated Minute): A rich-text editor displaying the final output broken down by Noted, Discussed, and Action Items. The CoSec can type and edit manually here if desired.

Right Pane (The Dual-Chatbot):

Tab 1: Chatbot ASK: A chat interface strictly for querying the transcript/slides (e.g., "What was the exact LCR percentage mentioned?").

Tab 2: Chatbot CHANGE: An agentic chat interface for targeted edits. Users can select a sentence on the Left Pane and type here: "Change this to formal tone." The AI updates the Left Pane in real-time.

Navigation: "Previous Agenda" and "Next Agenda" buttons to move through the meeting sequentially.

Page 5: Export & Finalization
Purpose: The final review before exporting the document for distribution.

Components:

Full Document Preview: Shows the compiled minutes for all agendas in one continuous document.

Action Item Summary: An auto-generated table pulling all action items and assignees into one list at the bottom.


Export Options: Download as Word Document (.docx) for final formatting or PDF for secure distribution.

Page 6: Committee Settings & Persona Management
Purpose: A centralized configuration page where the CoSec sets up the "rules of engagement" for different types of meetings so they do not have to rewrite system prompts every single time.

Committee Profile Builder - Users can create distinct profiles (e.g., ALCO, MRC, Board of Directors). Each profile contains a dedicated text box for the "System Persona" (e.g., instructing the AI on specific ALM jargon, LCR/NSFR contexts, or specific board member quirks).

Format Prompt Library - A repository where users can save and name their standard structural prompts. Instead of copy-pasting an old minute's format, the user can just select "Standard Approval Paper Format" from a dropdown during the generation phase.

Glossary & Jargon Manager - A simple table where the CoSec can input specific bank acronyms and their full meanings. The AI references this globally to ensure zero spelling mistakes for highly technical terms.

7. Page 7: Compliance & Audit Trail (The Digital Minute Book)

Purpose: A read-only dashboard designed strictly for regulatory compliance, specifically addressing the "Reasonable Precautions" requirement under Section 49 of the Companies Act 2016 for electronic minute books.
+1

Immutable Activity Log - A chronological table tracking every critical action. It records who uploaded the transcript, what time the AI generation was triggered, and who finalized the document. This feature provides the necessary audit trail to prevent falsification.
+1

Version Control History - If a finalized minute is reopened and edited via the Chatbot, the system saves the previous version as a strict backup. Auditors or Chief Risk Officers can view the exact changes made between versions.

8. Micro-Interactions & UI Details (Enhancing the Existing Pages)
To make the system feel like a premium, intelligent assistant rather than a clunky web tool, these specific UI behaviors must be coded:

Low-Confidence Highlighting (Page 4) - When the AI generates the minutes, any names, financial figures, or highly specific Action Items that the AI is mathematically unsure about will be subtly highlighted in yellow. This visually cues the CoSec to double-check that specific sentence using the Chatbot Ask feature.

Split/Merge Text Blocks (Page 3) - During the Highlight & Assign phase, a speaker might merge two agenda items in one breath. The UI must allow the user to highlight a single paragraph, right-click, and select "Split," allowing them to assign the first half to Agenda 8.1 and the second half to Agenda 8.2.

Streaming Generation States (Page 4) - When the user clicks "Generate" or asks the Chatbot Change to rewrite a section, the text should stream onto the screen word-by-word (leveraging the Vercel AI SDK). This prevents the user from staring at a static loading spinner and builds trust as they watch the AI "think" and write.

1. "Zero-Retention" Data Policy (For the Non-BYOS MVP)
Purpose: Since the MVP will run on a standard cloud architecture (e.g., Next.js hosted on Vercel/Supabase) before transitioning to the fully sovereign BYOS model, the system must mathematically guarantee that sensitive ALCO audio and transcripts are not hoarded.

Ephemeral Processing: Raw video/audio files uploaded for Speech-to-Text are immediately purged from the server's temporary storage the millisecond the transcription is complete.

Auto-Purge Mechanism: The raw .docx transcript and the original Slide Deck PDFs are automatically permanently deleted from the database 30 days after the meeting status is marked as "Finalized". Only the final generated minute and the Audit Log remain in the system.

10. Automated Action Item Extraction (Centralized Table)
Purpose: Dalam mesyuarat jawatankuasa kritikal, benda paling penting selepas perbincangan adalah eksekusi (siapa kena buat apa, bila due date). Daripada CoSec terpaksa scroll baca setiap agenda untuk cari senarai Action Items, sistem tolong kumpulkan semua sekaligus.

Macam mana ia berfungsi: Bila semua Agenda dah siap di-generate oleh AI, kita tambah satu script kecil kat Next.js untuk ekstrak semua ayat di bawah tajuk "Action Items" dari Agenda 1 sampai Agenda akhir.

Hasil (Output): Sistem automatik hasilkan satu jadual rumusan (Summary Table) kat bahagian paling bawah dokumen minit tu, atau kat satu tab khas kat dashboard. Jadual tu ada lajur: No. Agenda | Tugasan | PIC (Person In Charge).

Kenapa ni gempak untuk MVP: Ini terus tukar secretariat.my daripada sekadar pembuat dokumen kepada alat pengurusan kerja. Kos nak buat ni hampir zero sebab AI dah asingkan Action Item masa langkah ke-3 (Prompt 3) tadi.

11. Quick Speaker Mapping (Voice-to-Name Initialization)
Purpose: Menyelesaikan masalah fail rakaman (audio/video) yang tak ada label nama macam Microsoft Teams, dan memastikan AI kenal siapa yang bercakap supaya Minit lebih tepat.

Macam mana ia berfungsi: Bila pengguna guna Mode 1 (upload fail audio dan kita guna Whisper diarization), sistem asalnya akan keluarkan transkrip sebagai "Speaker A", "Speaker B", "Speaker C".

UX/UI: Sebelum pengguna masuk fasa Highlight & Assign ke kotak Agenda, kita buat satu pop-up ringkas. Sistem akan mainkan 3 saat klip audio Speaker A, dan pengguna cuma perlu taip nama: "Oh, ni Pengerusi (Dato' X)".

Hasil: Seluruh transkrip yang panjang berjela tu terus bertukar dari "Speaker A/B" kepada nama sebenar secara automatik sebelum AI mula buat rumusan minit. Ini sangat mengurangkan ralat AI tersalah assign orang yang buat keputusan.