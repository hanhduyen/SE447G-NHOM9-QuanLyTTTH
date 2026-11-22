package com.fitcenter.staffbackend.repository;

import com.fitcenter.staffbackend.model.StaffNotification;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface NotificationRepository
        extends JpaRepository<StaffNotification, Long> {

    List<StaffNotification> findAllByOrderByCreatedAtDesc();
}
