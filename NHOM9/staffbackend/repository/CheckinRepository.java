package com.fitcenter.staffbackend.repository;

import com.fitcenter.staffbackend.model.Checkin;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface CheckinRepository extends JpaRepository<Checkin, Long> {
    List<Checkin> findByClassId(Long classId);
    boolean existsByCustomerIdAndSessionId(Long customerId, Long sessionId);
}

