#!/bin/bash
team-db "SELECT id, title, status FROM tasks WHERE assigned_to = 'agent-backend-developer' AND status IN ('backlog', 'in-progress') LIMIT 5"