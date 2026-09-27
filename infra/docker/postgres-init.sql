-- Runs once when the Postgres volume is first created.
-- A separate database for integration tests so they never touch dev data.
-- Extensions (pgvector) are created by Prisma migrations.
CREATE DATABASE praxis_test OWNER praxis;
