'use client'

import { useEffect, useState } from 'react'
import { Loader2, Sparkles, ChevronDown, X, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dropzone } from '@/components/dropzone'

const COMMON_LANGUAGES = ['English', 'Malay', 'Mandarin', 'Tamil', 'Bilingual (English/Malay)'] as const

export interface GenerateConfig {
  recordingFile: File | null
  transcriptFile: File | null
  languages: string[]
  useTeamsTranscription: boolean
  speakerMatchMethod: 'teams_transcript' | 'manual' | 'diarization'
  agendaDeviationPrompt: string
  meetingRulesPrompt: string
  highlightPrompt?: string
  excludeDeckPoints: boolean
}

interface GenerateFormProps {
  onGenerate: (config: GenerateConfig) => void
  isPending: boolean
  initialMeetingRules?: string
  isGenerateDisabled?: boolean
  generateDisabledReason?: string
}

export function GenerateForm({
  onGenerate,
  isPending,
  initialMeetingRules = '',
  isGenerateDisabled = false,
  generateDisabledReason,
}: GenerateFormProps) {
  const [recordingFile, setRecordingFile] = useState<File | null>(null)
  const [transcriptFile, setTranscriptFile] = useState<File | null>(null)
  const [languages, setLanguages] = useState<string[]>(['English'])
  const [customLang, setCustomLang] = useState('')
  const [useTeamsTranscription, setUseTeamsTranscription] = useState(false)
  const [speakerMatchMethod, setSpeakerMatchMethod] = useState<GenerateConfig['speakerMatchMethod']>('teams_transcript')
  const [agendaDeviationPrompt, setAgendaDeviationPrompt] = useState('')
  const [meetingRulesPrompt, setMeetingRulesPrompt] = useState(initialMeetingRules)
  const [excludeDeckPoints, setExcludeDeckPoints] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  useEffect(() => {
    setMeetingRulesPrompt(initialMeetingRules)
  }, [initialMeetingRules])

  function toggleLang(lang: string) {
    setLanguages(prev => prev.includes(lang) ? prev.filter(l => l !== lang) : [...prev, lang])
  }

  function addCustomLang() {
    const trimmed = customLang.trim()
    if (trimmed && !languages.includes(trimmed)) {
      setLanguages(prev => [...prev, trimmed])
      setCustomLang('')
    }
  }

  function handleGenerate() {
    onGenerate({
      recordingFile, transcriptFile, languages, useTeamsTranscription,
      speakerMatchMethod,
      agendaDeviationPrompt,
      meetingRulesPrompt,
      highlightPrompt: meetingRulesPrompt,
      excludeDeckPoints,
    })
  }

  return (
    <div className="space-y-6">
      {/* 1. Upload Recording — only when toggle OFF */}
      {!useTeamsTranscription && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">Upload Recording</Label>
          <Dropzone
            accept="audio/*,video/*"
            label="Drop Recording"
            hint="MP3, MP4, WAV, or other audio/video"
            onFile={async (file) => { setRecordingFile(file) }}
          />
        </div>
      )}

      {/* 2. Language Selection */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Language</Label>
        <div className="flex flex-wrap gap-1.5">
          {COMMON_LANGUAGES.map(lang => (
            <Badge
              key={lang}
              variant={languages.includes(lang) ? 'default' : 'outline'}
              className={`cursor-pointer text-xs ${languages.includes(lang) ? '' : 'opacity-60 hover:opacity-100'}`}
              onClick={() => toggleLang(lang)}
            >
              {lang}
              {languages.includes(lang) && <X className="ml-1 h-3 w-3" />}
            </Badge>
          ))}
          {languages.filter(l => !(COMMON_LANGUAGES as readonly string[]).includes(l)).map(lang => (
            <Badge key={lang} className="cursor-pointer text-xs" onClick={() => toggleLang(lang)}>
              {lang}
              <X className="ml-1 h-3 w-3" />
            </Badge>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={customLang}
            onChange={e => setCustomLang(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomLang() } }}
            placeholder="Add other language..."
            className="h-7 text-xs"
          />
          <Button type="button" variant="outline" size="sm" className="h-7 px-2 shrink-0" onClick={addCustomLang} disabled={!customLang.trim()}>
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* 3. Teams Transcription Toggle */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <Label htmlFor="teams-toggle" className="text-sm leading-snug cursor-pointer">
            Use Microsoft Teams Transcription without uploading meeting pack (Save tokens)
          </Label>
          <Switch
            id="teams-toggle"
            checked={useTeamsTranscription}
            onCheckedChange={(checked) => {
              setUseTeamsTranscription(checked)
              if (checked) setRecordingFile(null)
            }}
          />
        </div>
        {useTeamsTranscription && (
          <Dropzone
            accept=".docx,.vtt"
            label="Attach the transcript file"
            hint="DOCX or VTT from Microsoft Teams"
            onFile={async (file) => { setTranscriptFile(file) }}
          />
        )}
      </div>

      {/* 4. Speaker Matching */}
      <div className={`space-y-3 transition-opacity ${useTeamsTranscription ? 'opacity-40 pointer-events-none' : ''}`}>
        <Label className="text-sm font-medium">Speaker Matching</Label>
        <RadioGroup
          value={speakerMatchMethod}
          onValueChange={(v) => setSpeakerMatchMethod(v as GenerateConfig['speakerMatchMethod'])}
          disabled={useTeamsTranscription}
          className="space-y-2"
        >
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="teams_transcript" id="sm-teams" />
              <Label htmlFor="sm-teams" className="text-sm cursor-pointer">
                Match the speaker based on attached Microsoft Teams Transcription
              </Label>
            </div>
            {!useTeamsTranscription && speakerMatchMethod === 'teams_transcript' && (
              <div className="ml-6">
                <Dropzone
                  accept=".docx,.vtt"
                  label="Attach the transcript file"
                  hint="DOCX or VTT from Microsoft Teams"
                  onFile={async (file) => { setTranscriptFile(file) }}
                />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="manual" id="sm-manual" />
            <Label htmlFor="sm-manual" className="text-sm cursor-pointer">
              Match the Speaker Manually
            </Label>
          </div>
          <div className="flex items-center gap-2 opacity-50">
            <RadioGroupItem value="diarization" id="sm-diarization" disabled />
            <Label htmlFor="sm-diarization" className="text-sm cursor-not-allowed">
              Match the speaker with diarization (soon)
            </Label>
          </div>
        </RadioGroup>
      </div>

      {/* 5. Agenda Deviation Prompt */}
      <div className="space-y-2">
        <Label htmlFor="agenda-deviation" className="text-sm font-medium">
          Did the meeting run based on the arranged agenda? If not, please let Secretariat know!
        </Label>
        <Textarea
          id="agenda-deviation"
          value={agendaDeviationPrompt}
          onChange={(e) => setAgendaDeviationPrompt(e.target.value)}
          placeholder="e.g. Agenda 3 was discussed before Agenda 2..."
          rows={3}
          maxLength={2000}
          className="resize-y"
        />
      </div>

      {/* 6. Meeting Rules */}
      <div className="space-y-2">
        <Label htmlFor="meeting-rules" className="text-sm font-medium">
          Meeting rules for Secretariat (applied during Analyze and Generate)
        </Label>
        <Textarea
          id="meeting-rules"
          value={meetingRulesPrompt}
          onChange={(e) => setMeetingRulesPrompt(e.target.value)}
          placeholder='e.g. Use "Head, TD" instead of "The Section Head of TD". Use Islamic finance terms; avoid "Loan" and "Interest".'
          rows={3}
          maxLength={2000}
          className="resize-y"
        />
      </div>

      {/* 7. Advanced Settings */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 text-sm font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300 transition-colors">
          <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
          Advanced Settings
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3 space-y-3">
          <div className="flex items-start gap-2">
            <Checkbox
              id="exclude-deck"
              checked={excludeDeckPoints}
              onCheckedChange={(v) => setExcludeDeckPoints(v === true)}
            />
            <Label htmlFor="exclude-deck" className="text-sm leading-snug cursor-pointer">
              Exclude the point that already stated in the decks
            </Label>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Generate Button */}
      <Button onClick={handleGenerate} disabled={isPending || isGenerateDisabled} className="w-full gap-2">
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {useTeamsTranscription ? 'Analyze Transcript' : 'Generate'}
      </Button>
      {isGenerateDisabled && generateDisabledReason ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">{generateDisabledReason}</p>
      ) : null}
    </div>
  )
}
