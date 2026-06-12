# Project Requirement — chipint-front

> สเปกตั้งต้นของโปรเจกต์ frontend ร้านค้าออนไลน์ chipint (หุ่นยนต์/ชิป)

## ภาพรวม
เว็บหน้าร้าน (storefront) สำหรับขายหุ่นยนต์และชิป — แสดงแคตตาล็อกสินค้า รายละเอียดสินค้า
และตะกร้าสินค้า (cart)

## ขอบเขตงานหลัก
- **แคตตาล็อกสินค้า (RobotCatalog):** แสดงรายการหุ่นยนต์ พร้อมตัวกรอง (filter)
- **รายละเอียดสินค้า (RobotDetail):** หน้ารายละเอียดของแต่ละสินค้า
- **ตะกร้าสินค้า (Cart):** เพิ่ม/ลบสินค้า คำนวณยอด ส่งฟรีเมื่อยอดเกิน ฿5,000
- **หน้าแรก (Home):** Hero + สินค้าแนะนำ (Featured)

## เทคโนโลยีที่กำหนด
Next.js 16 · React 19 · TypeScript · Tailwind CSS v4 · **Ant Design 6** · TanStack React Query 5 · Axios · lucide-react

## หลักการออกแบบโค้ด
- โครง: `lib/api → services → hooks → components/partials/[Feature]`
- type 2 ชั้น: API contract (`types/api`) แยกจาก app domain (`types/app`)
- server state ใช้ React Query เท่านั้น, cart state ใช้ React Context
