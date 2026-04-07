-- Fix: LinkedIn URLs stored in countryNormalized instead of linkedinUrl
-- ~113k github_user rows affected by a historical migration bug.
--
-- Run: pnpm fix:country-linkedin

SET statement_timeout = 0;

BEGIN;

-- Report before
SELECT COUNT(*) AS corrupted_rows FROM github_user WHERE "countryNormalized" LIKE 'http%';

-- Move URLs to linkedinUrl (if NULL), clear countryNormalized
UPDATE github_user
SET
  "linkedinUrl" = CASE
    WHEN "linkedinUrl" IS NULL THEN "countryNormalized"
    ELSE "linkedinUrl"
  END,
  "countryNormalized" = NULL
WHERE "countryNormalized" LIKE 'http%';

-- Report after
SELECT COUNT(DISTINCT "countryNormalized") AS distinct_countries
FROM github_user
WHERE "countryNormalized" IS NOT NULL AND "countryNormalized" NOT LIKE 'http%';

COMMIT;
