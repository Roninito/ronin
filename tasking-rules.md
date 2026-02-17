# Tasking Rules

This file contains rules and guidelines for AI-driven task scheduling and execution.

## Priority Rules

- High priority tasks should be instantiated more frequently
- Tasks with recent failures should be paused or delayed
- Tasks with high success rates should be prioritized

## Frequency Guidelines

- Daily tasks: Create instance once per day
- Weekly tasks: Create instance once per week
- Ad-hoc tasks: Create instance when context suggests it's needed

## Task Types

- Maintenance tasks: Run during low-activity periods
- Monitoring tasks: Run regularly based on importance
- One-time tasks: Execute immediately when created

## Execution Strategy

- Consider current board load before creating new instances
- Avoid creating too many instances simultaneously
- Respect dependencies between tasks

## Notes

Customize these rules based on your workflow and priorities.
