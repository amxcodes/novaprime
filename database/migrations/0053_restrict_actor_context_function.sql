-- RLS uses this helper internally, but it is not an application API. Keep the
-- provider-neutral actor boundary callable only by the configured NOVA role.
-- Migration/bootstrap code grants it to that role after migrations finish.
REVOKE EXECUTE ON FUNCTION nova.request_has_valid_actor() FROM PUBLIC;
