CREATE TABLE "riv_action_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"kind" "action_kind" NOT NULL,
	"reason" text NOT NULL,
	"preview" jsonb NOT NULL,
	"risk_level" "risk_level" NOT NULL,
	"requires_confirmation" boolean DEFAULT true NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"status" "proposal_status" NOT NULL,
	"confirmation" jsonb,
	"execution_result" jsonb
);
--> statement-breakpoint
CREATE TABLE "riv_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "riv_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_invocations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "riv_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "riv_action_proposals" ADD CONSTRAINT "riv_action_proposals_thread_id_riv_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."riv_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riv_messages" ADD CONSTRAINT "riv_messages_thread_id_riv_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."riv_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "riv_action_proposals_thread_created_idx" ON "riv_action_proposals" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "riv_memories_user_updated_idx" ON "riv_memories" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "riv_messages_thread_created_idx" ON "riv_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "riv_threads_user_id_idx" ON "riv_threads" USING btree ("user_id");