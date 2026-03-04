const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const UserPreference = sequelize.define('UserPreference', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        user_id: {
            type: DataTypes.UUID,
            allowNull: false,
            unique: true,
        },
        budget_min: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: true,
        },
        budget_max: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: true,
        },
        preferred_location: {
            type: DataTypes.STRING(255),
            allowNull: true,
        },
        preferred_districts: {
            type: DataTypes.ARRAY(DataTypes.STRING),
            allowNull: true,
            defaultValue: [],
        },
        preferred_gender: {
            type: DataTypes.STRING(20),
            allowNull: true,
        },
        room_type: {
            type: DataTypes.STRING(30),
            allowNull: true,
        },
        preferred_amenities: {
            type: DataTypes.ARRAY(DataTypes.STRING),
            allowNull: true,
            defaultValue: [],
        },
        must_have_amenities: {
            type: DataTypes.ARRAY(DataTypes.STRING),
            allowNull: true,
            defaultValue: [],
        },
        preferred_lease_months: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        move_in_date_min: {
            type: DataTypes.DATEONLY,
            allowNull: true,
        },
        move_in_date_max: {
            type: DataTypes.DATEONLY,
            allowNull: true,
        },
        max_distance_km: {
            type: DataTypes.DECIMAL(6, 2),
            allowNull: true,
        },
        transport_nearby: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
        },
        pet_friendly: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
        },
        preferred_roommate_age_min: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        preferred_roommate_age_max: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        lifestyle_match_weight: {
            type: DataTypes.DECIMAL(3, 2),
            allowNull: true,
        },
        safety_priority: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
    }, {
        tableName: 'user_preferences',
        timestamps: true,
        underscored: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
    });

    UserPreference.associate = (models) => {
        UserPreference.belongsTo(models.User, {
            foreignKey: 'user_id',
            as: 'user',
        });
    };

    return UserPreference;
};
