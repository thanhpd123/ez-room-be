const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const UserPreference = sequelize.define('UserPreference', {
        preference_id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        user_id: {
            type: DataTypes.UUID,
            allowNull: false,
            unique: true,
        },
        min_price: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: true,
        },
        max_price: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: true,
        },
        preferred_location: {
            type: DataTypes.STRING(255),
            allowNull: true,
        },
        preferred_amenities: {
            type: DataTypes.ARRAY(DataTypes.STRING),
            allowNull: true,
        },
        lifestyle_weight: {
            type: DataTypes.DECIMAL(3, 2),
            allowNull: true,
            defaultValue: 0.5,
        },
    }, {
        tableName: 'user_preferences',
        timestamps: false,
    });

    UserPreference.associate = (models) => {
        UserPreference.belongsTo(models.User, {
            foreignKey: 'user_id',
            as: 'user',
        });
    };

    return UserPreference;
};
