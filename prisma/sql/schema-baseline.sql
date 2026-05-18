-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "geocache" (
    "key" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,

    CONSTRAINT "geocache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "badge_cache" (
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "mappedCount" INTEGER NOT NULL,
    "countryCount" INTEGER NOT NULL,
    "totalCount" INTEGER NOT NULL,
    "language" TEXT,
    "forksCount" INTEGER,
    "watchersCount" INTEGER,
    "organicScore" INTEGER,
    "organicTier" TEXT,
    "organicComputedAt" TIMESTAMP(3),
    "openIssuesCount" INTEGER,
    "openPRsCount" INTEGER,
    "latestReleaseTag" TEXT,
    "latestReleaseUrl" TEXT,
    "latestReleaseAt" TIMESTAMP(3),
    "releasesCount" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "badge_cache_pkey" PRIMARY KEY ("owner","repo")
);

-- CreateTable
CREATE TABLE "stargazer_cache" (
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "points" TEXT NOT NULL,
    "unmapped" TEXT NOT NULL,
    "totalCount" INTEGER NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latestStarredAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL DEFAULT NOW() + INTERVAL '90 days',

    CONSTRAINT "stargazer_cache_pkey" PRIMARY KEY ("owner","repo")
);

-- CreateTable
CREATE TABLE "github_user" (
    "login" TEXT NOT NULL,
    "name" TEXT,
    "company" TEXT,
    "location" TEXT,
    "followers" INTEGER NOT NULL DEFAULT 0,
    "following" INTEGER NOT NULL DEFAULT 0,
    "publicRepos" INTEGER NOT NULL DEFAULT 0,
    "accountCreatedAt" TIMESTAMP(3),
    "dataVersion" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'stargazer',
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "linkedinUrl" TEXT,
    "countryNormalized" TEXT,
    "cityNormalized" TEXT,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "languagesFetchedAt" TIMESTAMP(3),
    "topRepos" JSONB,
    "topReposFetchedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_user_pkey" PRIMARY KEY ("login")
);

-- CreateTable
CREATE TABLE "news" (
    "id" SERIAL NOT NULL,
    "authorLogin" VARCHAR(39) NOT NULL,
    "body" VARCHAR(280) NOT NULL,
    "url" VARCHAR(500),
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "news_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "star_event" (
    "id" SERIAL NOT NULL,
    "login" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "starredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "star_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deletion_log" (
    "id" SERIAL NOT NULL,
    "login" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notes" TEXT,

    CONSTRAINT "deletion_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_view" (
    "type" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "page_view_pkey" PRIMARY KEY ("type","slug","date")
);

-- CreateTable
CREATE TABLE "api_key" (
    "key" TEXT NOT NULL,
    "keyHash" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "api_key_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "badge_cache_updatedAt_idx" ON "badge_cache"("updatedAt" DESC);

-- CreateIndex
CREATE INDEX "stargazer_cache_expiresAt_idx" ON "stargazer_cache"("expiresAt");

-- CreateIndex
CREATE INDEX "github_user_followers_idx" ON "github_user"("followers" DESC);

-- CreateIndex
CREATE INDEX "github_user_company_idx" ON "github_user"("company");

-- CreateIndex
CREATE INDEX "github_user_location_idx" ON "github_user"("location");

-- CreateIndex
CREATE INDEX "github_user_lat_lng_idx" ON "github_user"("lat", "lng");

-- CreateIndex
CREATE INDEX "github_user_countryNormalized_idx" ON "github_user"("countryNormalized");

-- CreateIndex
CREATE INDEX "github_user_cityNormalized_idx" ON "github_user"("cityNormalized");

-- CreateIndex
CREATE INDEX "github_user_languagesFetchedAt_idx" ON "github_user"("languagesFetchedAt");

-- CreateIndex
CREATE INDEX "github_user_fetchedAt_idx" ON "github_user"("fetchedAt");

-- CreateIndex
CREATE INDEX "news_author_published_idx" ON "news"("authorLogin", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "news_published_idx" ON "news"("publishedAt" DESC);

-- CreateIndex
CREATE INDEX "star_event_owner_repo_login_idx" ON "star_event"("owner", "repo", "login");

-- CreateIndex
CREATE UNIQUE INDEX "star_event_login_owner_repo_key" ON "star_event"("login", "owner", "repo");

-- CreateIndex
CREATE INDEX "deletion_log_login_idx" ON "deletion_log"("login");

-- CreateIndex
CREATE INDEX "deletion_log_requestedAt_idx" ON "deletion_log"("requestedAt" DESC);

-- CreateIndex
CREATE INDEX "page_view_slug_idx" ON "page_view"("slug");

-- CreateIndex
CREATE INDEX "page_view_type_date_idx" ON "page_view"("type", "date");

-- CreateIndex
CREATE UNIQUE INDEX "api_key_keyHash_key" ON "api_key"("keyHash");

-- AddForeignKey
ALTER TABLE "news" ADD CONSTRAINT "news_authorLogin_fkey" FOREIGN KEY ("authorLogin") REFERENCES "github_user"("login") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "star_event" ADD CONSTRAINT "star_event_login_fkey" FOREIGN KEY ("login") REFERENCES "github_user"("login") ON DELETE RESTRICT ON UPDATE CASCADE;

