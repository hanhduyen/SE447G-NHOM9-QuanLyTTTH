package com.fitcenter.staffbackend.model;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "fitness_classes")
public class FitnessClass {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String className;
    private Integer capacity;
    private Integer enrolledCount;

    // 0: Chưa mở, 1: Đang mở, 2: Đã đóng, 3: Kết thúc
    private Integer registrationStatus;

    public FitnessClass() {}

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getClassName() { return className; }
    public void setClassName(String className) { this.className = className; }

    public Integer getCapacity() { return capacity; }
    public void setCapacity(Integer capacity) { this.capacity = capacity; }

    public Integer getEnrolledCount() { return enrolledCount; }
    public void setEnrolledCount(Integer enrolledCount) { this.enrolledCount = enrolledCount; }

    public Integer getRegistrationStatus() { return registrationStatus; }
    public void setRegistrationStatus(Integer registrationStatus) { this.registrationStatus = registrationStatus; }
}
