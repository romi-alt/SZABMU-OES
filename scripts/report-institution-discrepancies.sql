-- READ-ONLY. Lists institutions whose affiliation may have been rewritten by the pre-fix PATCH (UI-002).
-- Before the fix every PATCH /institutions/:id wrote `affiliation = CONSTITUENT` unless the caller sent one, and the audit entry
-- recorded the *injected* value, so an audit entry with meta.affiliation proves a PATCH ran but not that the user chose that value.
-- institution.create audit entries do not record the original affiliation, so the original value is NOT recoverable from the audit
-- trail alone: restoration needs an owner decision and an authoritative source (university records).
SELECT i.code, i.name, i.affiliation AS current_affiliation, i.active,
       count(a.*) FILTER (WHERE a.action = 'institution.update')                                   AS update_entries,
       count(a.*) FILTER (WHERE a.action = 'institution.update' AND a.meta ? 'affiliation')         AS updates_with_affiliation_key,
       count(a.*) FILTER (WHERE a.action = 'institution.update' AND a.meta ->> 'affiliation' = 'CONSTITUENT') AS updates_that_wrote_constituent,
       min(a.at) FILTER (WHERE a.action = 'institution.update')                                    AS first_update,
       max(a.at) FILTER (WHERE a.action = 'institution.update')                                    AS last_update
FROM institutions i
LEFT JOIN audit_logs a ON a.entity = 'institution' AND a."entityId" = i.id::text
GROUP BY i.id ORDER BY i.code;
