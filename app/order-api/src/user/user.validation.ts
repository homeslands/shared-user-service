import { createErrorCode, TErrorCodeValue } from 'src/app/app.validation';

export const USER_NOT_FOUND = 'USER_NOT_FOUND';
export const ERROR_CREATE_USER = 'ERROR_CREATE_USER';
export const CANNOT_UPDATE_CUSTOMER_ROLE = 'CANNOT_UPDATE_CUSTOMER_ROLE';
export const INVALID_LANGUAGE = 'INVALID_LANGUAGE';
export const OWNER_NOT_A_CUSTOMER = 'OWNER_NOT_A_CUSTOMER';
export const PHONENUMBER_SEARCH_TOO_BROAD = 'PHONENUMBER_SEARCH_TOO_BROAD';
export const BIRTHDAY_SEARCH_TOO_BROAD = 'BIRTHDAY_SEARCH_TOO_BROAD';
export type TUserErrorCodeKey =
  | typeof USER_NOT_FOUND
  | typeof CANNOT_UPDATE_CUSTOMER_ROLE
  | typeof ERROR_CREATE_USER
  | typeof INVALID_LANGUAGE
  | typeof OWNER_NOT_A_CUSTOMER
  | typeof PHONENUMBER_SEARCH_TOO_BROAD
  | typeof BIRTHDAY_SEARCH_TOO_BROAD;
export type TUserErrorCode = Record<TUserErrorCodeKey, TErrorCodeValue>;

// 137000 - 138000
export const UserValidation: TUserErrorCode = {
  USER_NOT_FOUND: createErrorCode(137000, 'User not found'),
  ERROR_CREATE_USER: createErrorCode(137001, 'Error when creating user'),
  CANNOT_UPDATE_CUSTOMER_ROLE: createErrorCode(
    137002,
    'Can not update customer role',
  ),
  INVALID_LANGUAGE: createErrorCode(137003, 'Invalid language'),
  OWNER_NOT_A_CUSTOMER: createErrorCode(137004, 'Owner is not a customer'),
  // QD4 (buoc 7.1) - POST /internal/users/search-by-phonenumber khop nhieu hon
  // tran (INTERNAL_SEARCH_BY_PHONENUMBER_MAX). Khai song doi CUNG SO o trend
  // va terminal (137005/137006 cua hai ben la ma rieng, 137007 trong o ca ba).
  PHONENUMBER_SEARCH_TOO_BROAD: createErrorCode(
    137007,
    'Phone number search matches too many users, please narrow the search',
  ),
  // Buoc 8.1 - POST /internal/users/by-birthday khop nhieu hon tran
  // (INTERNAL_SEARCH_BY_BIRTHDAY_MAX). Khai song doi cung so o trend va terminal.
  BIRTHDAY_SEARCH_TOO_BROAD: createErrorCode(
    137008,
    'Date of birth search matches too many users, please narrow the range',
  ),
};
