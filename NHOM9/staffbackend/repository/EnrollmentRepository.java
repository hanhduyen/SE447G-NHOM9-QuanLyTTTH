package com.fitcenter.staffbackend.repository;

import com.fitcenter.staffbackend.model.Enrollment;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface EnrollmentRepository extends JpaRepository<Enrollment, Long> {
    List<Enrollment> findByClassId(Long classId);
    List<Enrollment> findByClassIdAndStatusOrderByRegistrationDateAsc(Long classId, Integer status);
}

