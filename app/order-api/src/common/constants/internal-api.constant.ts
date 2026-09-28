// Gioi han cua cac route /internal/* - PHAI GIU GIONG HET ben service tieu
// thu (trend/src/common/constants/internal-api.constant.ts). Ben goi tu chia
// lo theo dung hang so nay; ben nhan tu choi (400) khi vuot - KHONG cat bot
// im lang, vi cat im lang la mat nguoi trong danh sach ma khong ai biet.

// QD21 - POST /internal/users/list-recent. Luoi rong quet cua so 48 gio,
// co the la vai nghin hang sau mot dot su co => phan trang la BAT BUOC,
// khong con la de phong. Ben goi lap cho toi khi tra ve it hon `limit`.
export const INTERNAL_LIST_RECENT_MAX_LIMIT = 500;
export const INTERNAL_LIST_RECENT_DEFAULT_LIMIT = 200;

// Header mang ten service goi. KHONG nam trong chu ky HMAC: hom nay hai ben
// dung CHUNG mot `INTERNAL_API_SECRET`, nen mot service da co secret thi ky
// duoc bat ky noi dung nao - dua header vao chu ky cung khong chong duoc
// gia danh. Khi nao moi service co secret rieng thi danh tinh moi that su
// xac thuc duoc; ghi lai o day de lan do khong phai suy lai.
export const INTERNAL_SERVICE_HEADER = 'x-internal-service';
