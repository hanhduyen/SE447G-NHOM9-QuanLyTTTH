package com.fitcenter.staffbackend.config;

import com.fitcenter.staffbackend.model.*;
import com.fitcenter.staffbackend.repository.*;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Configuration
public class DataInitializer {

    @Bean
    CommandLineRunner initData(
            ProductRepository products,
            FitnessClassRepository classes,
            EnrollmentRepository enrollments,
            NotificationRepository notifications) {

        return args -> {

            // Sản phẩm mẫu
            if (products.count() == 0) {
                Product p1 = new Product();
                p1.setProductName("Nước suối");
                p1.setPrice(new BigDecimal("10000"));
                p1.setQuantity(100);
                products.save(p1);

                Product p2 = new Product();
                p2.setProductName("Khăn tập");
                p2.setPrice(new BigDecimal("50000"));
                p2.setQuantity(30);
                products.save(p2);

                Product p3 = new Product();
                p3.setProductName("Áo thể thao");
                p3.setPrice(new BigDecimal("150000"));
                p3.setQuantity(20);
                products.save(p3);
            }

            // Lớp học mẫu
            if (classes.count() == 0) {
                FitnessClass c = new FitnessClass();
                c.setClassName("Yoga cơ bản");
                c.setCapacity(20);
                c.setEnrolledCount(5);
                c.setRegistrationStatus(1);
                classes.save(c);
            }

            // Thông báo mẫu
            if (notifications.count() == 0) {
                StaffNotification n = new StaffNotification();
                n.setTitle("Chào mừng nhân viên");
                n.setContent("Hệ thống quản lý trung tâm đã sẵn sàng.");
                n.setIsRead(0);
                n.setCreatedAt(LocalDateTime.now());
                notifications.save(n);
            }
        };
    }
}
