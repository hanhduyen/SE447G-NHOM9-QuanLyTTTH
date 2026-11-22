package com.fitcenter.staffbackend.repository;

import com.fitcenter.staffbackend.model.Product;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProductRepository extends JpaRepository<Product, Long> {}
