# /test-prompts

Test the 3-Prompt AI engine with sample data to verify minute generation quality.

## Instructions
1. Read the current prompt templates from `src/lib/ai/prompts.ts`
2. Use a sample transcript and agenda to test each prompt stage:
   - Prompt 1: Context Cleaning
   - Prompt 2: Cross-Reference with slides
   - Prompt 3: Synthesis into Noted/Discussed/Action Items
3. Evaluate output for:
   - Correct banking terminology usage
   - Proper formatting (Noted, Discussed, Action Items)
   - Low-confidence item flagging
   - Persona consistency
4. Report results with suggestions for prompt improvement
