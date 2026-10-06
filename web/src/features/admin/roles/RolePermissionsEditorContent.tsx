import { RolePermissionsEditor } from "./RolePermissionsEditor";
import { projectRolePermissionsEditorProps } from "./projection";
import type { RolePermissionsProjectionInput } from "./projection";

export function RolePermissionsEditorContent(props: RolePermissionsProjectionInput) {
  return <RolePermissionsEditor {...projectRolePermissionsEditorProps(props)} />;
}
