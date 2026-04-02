-- Fix country normalization duplicates in github_user.countryNormalized
-- Run once against production DB: psql $DATABASE_URL -f scripts/fix-country-normalization.sql

UPDATE github_user SET "countryNormalized" = 'United States'
  WHERE "countryNormalized" = 'United States Of America';

UPDATE github_user SET "countryNormalized" = 'Democratic Republic of the Congo'
  WHERE "countryNormalized" = 'Democratic Republic Of The Congo';

UPDATE github_user SET "countryNormalized" = 'South Korea'
  WHERE "countryNormalized" = 'Republic Of Korea';

UPDATE github_user SET "countryNormalized" = 'Macao'
  WHERE "countryNormalized" = 'Macau';

-- Verify: should show 0 rows for each if fix applied correctly
SELECT 'United States Of America' AS bad_value, COUNT(*) FROM github_user WHERE "countryNormalized" = 'United States Of America'
UNION ALL
SELECT 'Democratic Republic Of The Congo', COUNT(*) FROM github_user WHERE "countryNormalized" = 'Democratic Republic Of The Congo'
UNION ALL
SELECT 'Republic Of Korea', COUNT(*) FROM github_user WHERE "countryNormalized" = 'Republic Of Korea'
UNION ALL
SELECT 'Macau', COUNT(*) FROM github_user WHERE "countryNormalized" = 'Macau';
