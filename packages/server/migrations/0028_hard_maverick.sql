CREATE TABLE "codeStateSnapshots" (
	"captureId" uuid PRIMARY KEY NOT NULL,
	"sessionId" text NOT NULL,
	"phase" text NOT NULL,
	"capturedAt" timestamp with time zone NOT NULL,
	"completedAt" timestamp with time zone NOT NULL,
	"snapshot" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "codeStateSnapshots_phase_check" CHECK ("codeStateSnapshots"."phase" in ('start', 'review'))
);
--> statement-breakpoint
ALTER TABLE "codeStateSnapshots" ADD CONSTRAINT "codeStateSnapshots_sessionId_sessions_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "codeStateSnapshots_one_start_idx" ON "codeStateSnapshots" USING btree ("sessionId") WHERE "codeStateSnapshots"."phase" = 'start';--> statement-breakpoint
CREATE INDEX "codeStateSnapshots_session_phase_idx" ON "codeStateSnapshots" USING btree ("sessionId","phase");