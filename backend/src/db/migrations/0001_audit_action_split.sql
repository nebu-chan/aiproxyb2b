-- Migrate old generic audit actions to granular action types.
-- Records where the diff contains "modelSettings" → policy update.
-- All others → info update.

UPDATE audit_logs
SET action = 'user.policy_updated'
WHERE action = 'user.updated'
  AND (
    diff->'after'  ? 'modelSettings'
    OR diff->'before' ? 'modelSettings'
  );

UPDATE audit_logs
SET action = 'user.info_updated'
WHERE action = 'user.updated';

UPDATE audit_logs
SET action = 'department.policy_updated'
WHERE action = 'department.updated'
  AND (
    diff->'after'  ? 'modelSettings'
    OR diff->'before' ? 'modelSettings'
  );

UPDATE audit_logs
SET action = 'department.info_updated'
WHERE action = 'department.updated';
