-- Jimothy's D10 Isekai JRPG: profile songs can be up to 25 MB (was 10 MB), so long songs fit.
-- Run once in the Supabase SQL Editor. Safe to run more than once.
update storage.buckets set file_size_limit = 26214400 where id = 'ourspace-music';
select id, file_size_limit from storage.buckets where id = 'ourspace-music';
