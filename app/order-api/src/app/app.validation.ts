import { AuthValidation } from 'src/auth/auth.validation';
import { AuthorityValidation } from 'src/authority/authority.validation';
import { DbValidation } from 'src/db/db.validation';
import FileValidation from 'src/file/file.validation';
import { BalanceValidation } from 'src/gift-card-modules/balance/balance.validation';
import { PointTransactionValidation } from 'src/gift-card-modules/point-transaction/point-transaction.validation';
import { MembershipCardValidation } from 'src/membership-card/membership-card.validation';
import { PermissionValidation } from 'src/permission/permission.validation';
import { RoleValidation } from 'src/role/role.validation';
import { SystemConfigValidation } from 'src/system-config/system-config.validation';
import { UserValidation } from 'src/user/user.validation';
import { ZaloOaConnectorValidation } from 'src/zalo-oa-connector/zalo-oa-connector.validation';

export type TErrorCodeValue = {
  code: number;
  message: string;
};
export type TErrorCode = Record<string, TErrorCodeValue>;

// Reusable function for creating error codes
export function createErrorCode(
  code: number,
  message: string,
): TErrorCodeValue {
  return { code, message };
}

export const AppValidation: TErrorCode = {
  ...AuthValidation,
  ...FileValidation,
  ...DbValidation,
  ...UserValidation,
  ...RoleValidation,
  ...SystemConfigValidation,
  ...AuthorityValidation,
  ...PermissionValidation,
  ...BalanceValidation,
  ...ZaloOaConnectorValidation,
  ...PointTransactionValidation,
  ...MembershipCardValidation,
};

const errorCodeKeys = Object.keys(AppValidation);
const errorCodeSet = new Set();

errorCodeKeys.forEach((key) => {
  const code = AppValidation[key].code;
  if (errorCodeSet.has(code)) {
    throw new Error(`Duplicate error code found: ${code}`);
  }
  errorCodeSet.add(code);
});
