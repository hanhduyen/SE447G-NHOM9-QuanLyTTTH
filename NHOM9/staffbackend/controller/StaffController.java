package com.fitcenter.staffbackend.controller;

import com.fitcenter.staffbackend.model.*;
import com.fitcenter.staffbackend.repository.*;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;


import com.fitcenter.staffbackend.repository.InvoiceDetailRepository;
import com.fitcenter.staffbackend.repository.NotificationRepository;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.*;

@RestController
@RequestMapping("/api/staff")
@CrossOrigin(origins = "*")
public class StaffController {

    private final InvoiceDetailRepository invoiceDetails;
p   private final NotificationRepository notifications;
    private final CheckinRepository checkins;
    private final EnrollmentRepository enrollments;
    private final FitnessClassRepository classes;
    private final ProductRepository products;
    private final InvoiceRepository invoices;

    public StaffController(
            CheckinRepository checkins,
            EnrollmentRepository enrollments,
            FitnessClassRepository classes,
            ProductRepository products,
            InvoiceDetailRepository invoiceDetails,
            NotificationRepository notifications,
            InvoiceRepository invoices) {
        this.checkins = checkins;
        this.enrollments = enrollments;
        this.classes = classes;
        this.products = products;
        this.invoiceDetails = invoiceDetails;
        this.notifications = notifications;
        this.invoices = invoices;
    }

    // UC11: Danh sách điểm danh
    @GetMapping("/checkins")
    public List<Checkin> getCheckins(
            @RequestParam(required = false) Long classId) {
        return classId == null
                ? checkins.findAll()
                : checkins.findByClassId(classId);
    }

    // UC11: Tạo điểm danh
    @PostMapping("/checkins")
    public ResponseEntity<?> createCheckin(@RequestBody Checkin data) {
        if (data.getCustomerId() == null || data.getSessionId() == null) {
            return ResponseEntity.badRequest().body("Thiếu khách hàng hoặc buổi học");
        }

        if (checkins.existsByCustomerIdAndSessionId(
                data.getCustomerId(), data.getSessionId())) {
            return ResponseEntity.badRequest().body("Khách hàng đã được điểm danh");
        }

        if (data.getStatus() == null) data.setStatus(1);
        data.setCheckinTime(LocalDateTime.now());

        return ResponseEntity.ok(checkins.save(data));
    }

    // UC13: Danh sách đăng ký
    @GetMapping("/enrollments")
    public List<Enrollment> getEnrollments(
            @RequestParam(required = false) Long classId) {
        return classId == null
                ? enrollments.findAll()
                : enrollments.findByClassId(classId);
    }

    // UC13: Duyệt hoặc từ chối đăng ký
    @PutMapping("/enrollments/{id}/decision")
    @Transactional
    public ResponseEntity<?> decideEnrollment(
            @PathVariable Long id,
            @RequestParam Integer decision) {

        if (decision != 2 && decision != 3) {
            return ResponseEntity.badRequest().body("Quyết định không hợp lệ");
        }

        Enrollment enrollment = enrollments.findById(id).orElse(null);

        if (enrollment == null) {
            return ResponseEntity.notFound().build();
        }

        if (enrollment.getStatus() != 1) {
            return ResponseEntity.badRequest().body("Đăng ký không ở trạng thái chờ xác nhận");
        }

        FitnessClass fitnessClass = classes.findById(enrollment.getClassId()).orElse(null);

        if (fitnessClass == null) {
            return ResponseEntity.badRequest().body("Không tìm thấy lớp học");
        }

        if (decision == 2) {
            if (fitnessClass.getEnrolledCount() >= fitnessClass.getCapacity()) {
                return ResponseEntity.badRequest().body("Lớp đã đủ số lượng");
            }
            fitnessClass.setEnrolledCount(fitnessClass.getEnrolledCount() + 1);
            classes.save(fitnessClass);
        }

        enrollment.setStatus(decision);
        return ResponseEntity.ok(enrollments.save(enrollment));
    }

    // UC13: Đưa đăng ký vào danh sách chờ
    @PostMapping("/enrollments/waitlist")
    public ResponseEntity<?> addWaitlist(@RequestBody Enrollment data) {
        FitnessClass fitnessClass = classes.findById(data.getClassId()).orElse(null);

        if (fitnessClass == null) {
            return ResponseEntity.badRequest().body("Không tìm thấy lớp");
        }

        data.setStatus(5);
        data.setRegistrationDate(LocalDateTime.now());

        return ResponseEntity.ok(enrollments.save(data));
    }

    // UC13: Chuyển người đầu danh sách chờ sang chờ xác nhận
    @PostMapping("/classes/{classId}/promote-waitlist")
    @Transactional
    public ResponseEntity<?> promoteWaitlist(@PathVariable Long classId) {
        FitnessClass fitnessClass = classes.findById(classId).orElse(null);

        if (fitnessClass == null) {
            return ResponseEntity.notFound().build();
        }

        if (fitnessClass.getEnrolledCount() >= fitnessClass.getCapacity()) {
            return ResponseEntity.badRequest().body("Lớp đã đủ số lượng");
        }

        List<Enrollment> waiting =
                enrollments.findByClassIdAndStatusOrderByRegistrationDateAsc(classId, 5);

        if (waiting.isEmpty()) {
            return ResponseEntity.badRequest().body("Danh sách chờ trống");
        }

        Enrollment first = waiting.get(0);
        first.setStatus(1); // Chờ nhân viên xác nhận, không tự động duyệt
        return ResponseEntity.ok(enrollments.save(first));
    }

    // UC21: Danh sách sản phẩm
    @GetMapping("/products")
    public List<Product> getProducts() {
        return products.findAll();
    }

    // UC21: Thêm sản phẩm
    @PostMapping("/products")
    public Product createProduct(@RequestBody Product product) {
        return products.save(product);
    }

    // UC21: Bán hàng tại quầy
    // @PostMapping("/checkout")
    // @Transactional
    // public ResponseEntity<?> checkout(@RequestBody Map<String, Object> request) {
    //     try {
    //         Long customerId = Long.valueOf(request.get("customerId").toString());

    //         List<Map<String, Object>> items =
    //                 (List<Map<String, Object>>) request.get("items");

    //         if (items == null || items.isEmpty()) {
    //             return ResponseEntity.badRequest().body("Giỏ hàng trống");
    //         }

    //         BigDecimal total = BigDecimal.ZERO;

    //         for (Map<String, Object> item : items) {
    //             Long productId = Long.valueOf(item.get("productId").toString());
    //             int quantity = Integer.parseInt(item.get("quantity").toString());

    //             Product product = products.findById(productId).orElse(null);

    //             if (product == null || quantity <= 0) {
    //                 return ResponseEntity.badRequest().body("Sản phẩm hoặc số lượng không hợp lệ");
    //             }

    //             if (product.getQuantity() < quantity) {
    //                 return ResponseEntity.badRequest().body(
    //                         "Không đủ tồn kho: " + product.getProductName());
    //             }

    //             total = total.add(product.getPrice().multiply(BigDecimal.valueOf(quantity)));
    //         }

    //         for (Map<String, Object> item : items) {
    //             Long productId = Long.valueOf(item.get("productId").toString());
    //             int quantity = Integer.parseInt(item.get("quantity").toString());

    //             Product product = products.findById(productId).orElseThrow();
    //             product.setQuantity(product.getQuantity() - quantity);
    //             products.save(product);
    //         }

    //         Invoice invoice = new Invoice();
    //         invoice.setCustomerId(customerId);
    //         invoice.setTotal(total);
    //         invoice.setStatus(1);
    //         invoice.setCreatedAt(LocalDateTime.now());

    //         return ResponseEntity.ok(invoices.save(invoice));

    //     } catch (Exception e) {
    //         return ResponseEntity.badRequest().body("Dữ liệu thanh toán không hợp lệ");
    //     }
    // }


@PostMapping("/checkout")
@Transactional
public ResponseEntity<?> checkout(
        @RequestBody Map<String, Object> request) {

    Long customerId;
    Map<Long, Integer> cart = new LinkedHashMap<>();

    try {
        customerId = Long.valueOf(request.get("customerId").toString());

        List<Map<String, Object>> items =
                (List<Map<String, Object>>) request.get("items");

        if (items == null || items.isEmpty()) {
            return ResponseEntity.badRequest().body("Giỏ hàng trống");
        }

        for (Map<String, Object> item : items) {
            Long productId =
                    Long.valueOf(item.get("productId").toString());

            Integer quantity =
                    Integer.valueOf(item.get("quantity").toString());

            if (quantity <= 0) {
                return ResponseEntity.badRequest()
                        .body("Số lượng phải lớn hơn 0");
            }

            cart.merge(productId, quantity, Integer::sum);
        }
    } catch (Exception e) {
        return ResponseEntity.badRequest()
                .body("Dữ liệu giỏ hàng không hợp lệ");
    }

    BigDecimal total = BigDecimal.ZERO;
    List<Product> selectedProducts = new ArrayList<>();

    // Kiểm tra toàn bộ sản phẩm trước khi trừ kho
    for (Map.Entry<Long, Integer> entry : cart.entrySet()) {
        Product product = products.findById(entry.getKey()).orElse(null);

        if (product == null) {
            return ResponseEntity.badRequest()
                    .body("Không tìm thấy sản phẩm ID: " + entry.getKey());
        }

        if (product.getQuantity() < entry.getValue()) {
            return ResponseEntity.badRequest()
                    .body("Không đủ tồn kho: " + product.getProductName());
        }

        total = total.add(
                product.getPrice().multiply(
                        BigDecimal.valueOf(entry.getValue())
                )
        );

        selectedProducts.add(product);
    }

    // Tạo hóa đơn
    Invoice invoice = new Invoice();
    invoice.setCustomerId(customerId);
    invoice.setTotal(total);
    invoice.setStatus(1);
    invoice.setCreatedAt(LocalDateTime.now());

    invoice = invoices.save(invoice);

    // Lưu chi tiết hóa đơn và cập nhật tồn kho
    for (Product product : selectedProducts) {
        Integer quantity = cart.get(product.getId());

        InvoiceDetail detail = new InvoiceDetail();
        detail.setInvoiceId(invoice.getId());
        detail.setProductId(product.getId());
        detail.setProductName(product.getProductName());
        detail.setQuantity(quantity);
        detail.setUnitPrice(product.getPrice());
        detail.setSubtotal(
                product.getPrice().multiply(
                        BigDecimal.valueOf(quantity)
                )
        );

        invoiceDetails.save(detail);

        product.setQuantity(product.getQuantity() - quantity);
        products.save(product);
    }

    return ResponseEntity.ok(invoice);
}


    // UC22: Tra cứu hóa đơn
    @GetMapping("/invoices")
    public List<Invoice> getInvoices() {
        return invoices.findAll();
    }

    // UC22: Chi tiết hóa đơn
    @GetMapping("/invoices/{id}")
    public ResponseEntity<?> getInvoice(@PathVariable Long id) {
        return invoices.findById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    // UC22: Xác nhận thanh toán
    @PutMapping("/invoices/{id}/pay")
    public ResponseEntity<?> payInvoice(@PathVariable Long id) {
        Invoice invoice = invoices.findById(id).orElse(null);

        if (invoice == null) {
            return ResponseEntity.notFound().build();
        }

        if (invoice.getStatus() != 1) {
            return ResponseEntity.badRequest().body("Hóa đơn không ở trạng thái chờ thanh toán");
        }

        invoice.setStatus(2);
        return ResponseEntity.ok(invoices.save(invoice));
    }

    // Tổng quan nhân viên
    @GetMapping("/summary")
    public Map<String, Object> getSummary() {
        Map<String, Object> result = new HashMap<>();
        result.put("totalCheckins", checkins.count());
        result.put("pendingEnrollments", enrollments.findAll()
                .stream().filter(e -> e.getStatus() == 1).count());
        result.put("totalProducts", products.count());
        result.put("pendingInvoices", invoices.findAll()
                .stream().filter(i -> i.getStatus() == 1).count());
        return result;
    }

    // UC22: Xem chi tiết các sản phẩm trong hóa đơn
    @GetMapping("/invoices/{id}/details")
    public ResponseEntity<?> getInvoiceDetails(@PathVariable Long id) {

        if (!invoices.existsById(id)) {
            return ResponseEntity.notFound().build();
        }

        return ResponseEntity.ok(
                invoiceDetails.findByInvoiceId(id)
        );
    }

    // Thông báo: Danh sách thông báo
    @GetMapping("/notifications")
    public List<StaffNotification> getNotifications() {
        return notifications.findAllByOrderByCreatedAtDesc();
    }

    // Thông báo: Đánh dấu một thông báo đã đọc
    @PutMapping("/notifications/{id}/read")
    public ResponseEntity<?> markNotificationRead(
            @PathVariable Long id) {

        StaffNotification notification =
                notifications.findById(id).orElse(null);

        if (notification == null) {
            return ResponseEntity.notFound().build();
        }

        notification.setIsRead(1);

        return ResponseEntity.ok(
                notifications.save(notification)
        );
    }

    // Thông báo: Đánh dấu tất cả đã đọc
    @PutMapping("/notifications/read-all")
    @Transactional
    public ResponseEntity<?> markAllNotificationsRead() {

        List<StaffNotification> list = notifications.findAll();

        for (StaffNotification notification : list) {
            notification.setIsRead(1);
        }

        notifications.saveAll(list);

        return ResponseEntity.ok("Đã đọc tất cả thông báo");
    }

    // Thông báo: Tạo thông báo
    @PostMapping("/notifications")
    public StaffNotification createNotification(
            @RequestBody StaffNotification notification) {

        notification.setIsRead(0);
        notification.setCreatedAt(LocalDateTime.now());

        return notifications.save(notification);
    }

}

