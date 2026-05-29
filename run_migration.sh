#!/bin/bash
cd /home/team/shared/backend
echo "Running migration..."
node migrations/run_009_referral.cjs > /tmp/migration_out.txt 2>&1
echo "Exit: $?"
echo "Output:"
cat /tmp/migration_out.txt