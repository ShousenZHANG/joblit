-- Non-secret local AI defaults (endpoint + profile only; never the API key).
CREATE TABLE "LocalAiSetting" (
  "userId" UUID NOT NULL,
  "hermesEndpoint" TEXT NOT NULL,
  "hermesProfile" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LocalAiSetting_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "LocalAiSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
