-- The design-sheet audit starts firing on its own.
--
-- `fires_on_stage_entry` is on `prompts` rather than in a version body,
-- because when a prompt runs is configuration and not content. Turning firing
-- on therefore needs no new version, and every run already recorded against
-- version 3 stays interpretable against exactly the wording that produced it.
--
-- design and drafting, the owner's decision on 2026-09-06: the sheet changes
-- substantially between them and each entry deserves its own look. Two model
-- runs per matter is the cost, accepted knowingly.
--
-- Selected by slug, not by a hard-coded id -- an earlier migration on this
-- branch pasted an id lifted by pattern from a previous file and got a
-- *version* id instead of the prompt's. The foreign key caught it, but
-- selecting by the stable thing removes the question.

update public.prompts
   set fires_on_stage_entry = array['design', 'drafting']
 where slug = 'ma-design-sheet-audit';
