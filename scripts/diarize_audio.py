#!/usr/bin/env python
import argparse
import json
import sys


def main() -> int:
  parser = argparse.ArgumentParser(description="Run speaker diarization with pyannote.audio")
  parser.add_argument("--input", required=True, help="Path to local audio/video file")
  parser.add_argument("--token", required=True, help="Hugging Face access token")
  parser.add_argument("--model", default="pyannote/speaker-diarization-3.1")
  args = parser.parse_args()

  try:
    from pyannote.audio import Pipeline
  except Exception as exc:
    print(f"pyannote.audio not installed: {exc}", file=sys.stderr)
    return 2

  try:
    pipeline = Pipeline.from_pretrained(args.model, use_auth_token=args.token)
    diarization = pipeline(args.input)
  except Exception as exc:
    print(f"Failed to run diarization: {exc}", file=sys.stderr)
    return 3

  rows = []
  for turn, _, speaker in diarization.itertracks(yield_label=True):
    rows.append({
      "speaker": str(speaker),
      "start": float(turn.start),
      "end": float(turn.end),
    })

  print(json.dumps(rows))
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
