import { z } from 'zod';

const id = (field: string) => z.string().regex(/^[0-9]{1,9}$/, `Invalid ${field}`);

export const roleParamsSchema = z.object({ roleId: id('roleId') });

export const createRoleSchema = z.object({
  name: z.string().trim().min(1, 'Enter a role name').max(40, 'Keep the name under 40 characters'),
  description: z.string().trim().max(200, 'Keep the description under 200 characters').nullish(),
  copyFromRoleId: id('copyFromRoleId').nullish(), // start from this role's permissions, null = blank
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const savePermissionsSchema = z.object({ permissions: z.array(z.string().min(1).max(64)).max(200) });

export const deleteRoleSchema = z.object({ moveToRoleId: id('moveToRoleId').nullish() });
